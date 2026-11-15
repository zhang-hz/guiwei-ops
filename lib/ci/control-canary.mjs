import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { digest, now } from '../core.mjs';
import { atomicJson } from '../filesystem.mjs';
import { boundedProcess, processSucceeded, restrictedHostEnvironment } from '../process.mjs';
import { scheduleSuites } from './scheduler.mjs';
import { aggregateSuites } from './report.mjs';
import { acceptCanary, acceptStartFailure } from './canary-verdict.mjs';
import { sourceParentCases } from '../../tests/ci/source-parent.mjs';

const PLAN = [
  ['pass', true], ['assertion', false], ['false-exit', false], ['empty', false], ['missing', false], ['invalid', false],
  ['forged', false], ['duplicate', false], ['extra-field', false], ['skip', false], ['exception', false], ['symlink', false], ['hardlink', false],
  ['timeout', false], ['output', false], ['tree', false], ['escape', true], ['environment', true], ['network', true], ['file-limit', false], ['output-quota', true],
];

function fixture(suite, mode, index) {
  return { ...suite, id: `canary-${mode}`, dependsOn: [], selectedFiles: ['tests/ci/canary.mjs'], selectedScopes: [],
    adapter: { runtime: 'node', entrypoint: 'tests/ci/canary.mjs', args: [mode] },
    resources: { ...suite.resources, outputBytes: mode === 'output' ? 16384 : 1048576 },
    timeoutMs: ['timeout', 'tree'].includes(mode) ? 3000 : 15000,
    canaryIndex: index };
}

export async function runControlCanary(backend, suite, context, { signal, timeoutMs, controlRoot, directory } = {}) {
  const startedAt = now();
  const deadline = Date.now() + Math.min(suite.timeoutMs, timeoutMs ?? suite.timeoutMs);
  const upstream = signal;
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort(upstream?.reason ?? 'interrupted');
  upstream?.addEventListener('abort', interrupt, { once: true });
  if (upstream?.aborted) interrupt();
  const timer = setTimeout(() => cancellation.abort('canary-timeout'), Math.max(1, deadline - Date.now()));
  signal = cancellation.signal;
  const evidence = [];
  const pending = new Map();
  let passed = 0;
  let failed = 0;
  let cleanupConfirmed = true;
  try {
  for (const item of await sourceParentCases(path.join(directory, 'tmp'), signal, deadline)) {
    evidence.push(item);
    if (item.accepted) passed++; else failed++;
  }
  for (const [index, [mode, expectedPass]] of PLAN.entries()) {
    if (signal?.aborted || Date.now() >= deadline) { failed += PLAN.length - index; break; }
    const actual = fixture(suite, mode, index);
    const name = `${context.name}-${index}`;
    const childContext = { ...context, name, volume: `${name}-out` };
    pending.set(name, childContext);
    const result = await backend.execute(actual, childContext, { signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    if (result.cleanup.confirmed) pending.delete(name);
    const accepted = acceptCanary(mode, result);
    if (accepted) passed++; else failed++;
    cleanupConfirmed &&= result.cleanup.confirmed;
    evidence.push({ mode, expectedPass, accepted, actual: result });
    if (mode === 'timeout') {
      // 真实超时闭环保留原样；边界位故障注入只检验判定，不能冒称真实OOM/残留。
      for (const kind of ['host-cleanup-flag', 'oom-flag', 'controller-error']) {
        const injected = structuredClone(result);
        if (kind === 'host-cleanup-flag') { injected.process.cleanupFailed = true; injected.reasons.push('cleanup-failed'); }
        if (kind === 'oom-flag') { injected.inspect.oomKilled = true; injected.reasons.push('memory-limit'); }
        if (kind === 'controller-error') injected.reasons.push('controller-error');
        const rejected = accepted && !acceptCanary('timeout', injected);
        if (rejected) passed++; else failed++;
        evidence.push({ mode: `timeout-${kind}`, accepted: rejected, injectionKind: 'verdict-boundary-only', actual: injected,
          originalMode: 'timeout', physicalFaultVerified: false });
      }
    }
  }
  // 启动请求前的故障只截获一次start；创建、状态查询与回收仍使用真实Engine。
  if (!signal.aborted && Date.now() < deadline) {
    const name = `${context.name}-start-failure`;
    const childContext = { ...context, name, volume: `${name}-out` };
    pending.set(name, childContext);
    const injected = Object.create(backend);
    let intercepted = 0;
    injected.command = (args, options) => {
      if (args[0] === 'start' && args[1] === '--attach' && args[2] === name) {
        intercepted++;
        return Promise.resolve({ exitCode: 1, signal: null, timedOut: false, overflow: false, interrupted: false, cleanupFailed: false, outputBytes: 0, outputSha256: digest('') });
      }
      return backend.command(args, options);
    };
    const actual = await injected.execute(fixture(suite, 'missing', 98), childContext, { signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    if (actual.cleanup.confirmed) pending.delete(name);
    const accepted = intercepted === 1 && acceptStartFailure(actual);
    if (accepted) passed++; else failed++;
    cleanupConfirmed &&= actual.cleanup.confirmed;
    evidence.push({ mode: 'start-failure', accepted, intercepted, actual });
  } else failed++;
  // 故意让移除命令失败，再用真实Engine查询证明聚合失败，最后由正常控制器回收。
  if (!signal?.aborted && Date.now() < deadline) {
    const name = `${context.name}-cleanup`;
    const childContext = { ...context, name, volume: `${name}-out` };
    pending.set(name, childContext);
    const injected = Object.create(backend);
    injected.command = (args, options) => args[0] === 'rm' || args[0] === 'volume' && args[1] === 'rm'
      ? Promise.resolve({ exitCode: 1, signal: null, timedOut: false, overflow: false, interrupted: false, cleanupFailed: false, outputBytes: 0, outputSha256: digest(''), stdout: '' })
      : backend.command(args, options);
    const failedCleanup = await injected.execute(fixture(suite, 'pass', 99), childContext, { signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    const recovered = await backend.cleanup(childContext, suite.cleanupTimeoutMs);
    if (recovered.confirmed) pending.delete(name);
    const accepted = acceptCanary('cleanup-failure', failedCleanup) && recovered.confirmed;
    if (accepted) passed++; else failed++;
    cleanupConfirmed &&= recovered.confirmed;
    evidence.push({ mode: 'cleanup-failure', accepted, actual: failedCleanup, recovered });
  } else failed++;
  for (const signalName of ['SIGTERM', 'SIGINT']) {
    if (signal?.aborted || Date.now() >= deadline) { failed++; continue; }
    const name = `${context.name}-${signalName.toLowerCase()}`;
    const childContext = { ...context, name, volume: `${name}-out` };
    pending.set(name, childContext);
    const nonce = randomBytes(32).toString('hex');
    const descriptor = path.join(directory, 'tmp', `${signalName}.json`);
    const actualSuite = { ...fixture(suite, 'ready-wait', 100), timeoutMs: 30000 };
    await atomicJson(descriptor, { nonce, suite: actualSuite, context: childContext });
    let sent = false;
    const child = await boundedProcess(process.execPath, [path.join(controlRoot, 'tests/ci/signal-parent.mjs'), descriptor], {
      env: { ...restrictedHostEnvironment(), OPS_PARENT_NONCE: nonce }, capture: true, outputBytes: 65536, timeoutMs: Math.min(60000, deadline - Date.now()), signal,
      onStdout: (chunk, process) => { if (!sent && chunk.toString().includes('"event":"ready"')) { sent = true; process.kill(signalName); } },
    });
    let actual;
    try { actual = child.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(value => value.event === 'result')?.result; } catch { actual = null; }
    const absent = await backend.verifyAbsent(childContext, suite.cleanupTimeoutMs);
    const accepted = sent && processSucceeded(child) && acceptCanary(signalName, actual) && absent;
    if (accepted) passed++; else failed++;
    let recovered = null;
    if (!absent) recovered = await backend.cleanup(childContext, suite.cleanupTimeoutMs);
    if (absent || recovered?.confirmed) pending.delete(name);
    cleanupConfirmed &&= absent || recovered?.confirmed === true;
    evidence.push({ mode: signalName, accepted, actual, independentlyAbsent: absent, recovered });
  }
  // 用真实反例结果接入调度与聚合，独立分支不能被失败分支吞掉。
  const failedResult = evidence.find(item => item.mode === 'assertion')?.actual;
  const goodResult = evidence.find(item => item.mode === 'pass')?.actual;
  if (failedResult && goodResult) {
    const a = { ...suite, id: 'branch-failed', dependsOn: [] };
    const b = { ...suite, id: 'branch-blocked', dependsOn: [a.id] };
    const c = { ...suite, id: 'branch-independent', dependsOn: [] };
    const values = await scheduleSuites([a, b, c], async item => ({ ...(item.id === a.id ? failedResult : goodResult), id: item.id }));
    const aggregate = aggregateSuites(values, [a, b, c]);
    const accepted = aggregate.status === 'failed' && values[1].status === 'blocked' && values[2].status === 'passed';
    if (accepted) passed++; else failed++;
    evidence.push({ mode: 'dependency-branches', accepted, actual: values });
  } else failed++;
  } catch {
    failed++;
    evidence.push({ mode: 'controller-error', accepted: false });
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener('abort', interrupt);
    const cleanupDeadline = Date.now() + suite.cleanupTimeoutMs;
    for (const [name, remaining] of pending) {
      const recovery = Date.now() < cleanupDeadline ? await backend.cleanup(remaining, cleanupDeadline - Date.now()) : { confirmed: false, elapsedMs: 0 };
      cleanupConfirmed &&= recovery.confirmed;
      evidence.push({ mode: 'finally-cleanup', name, recovery });
    }
  }
  if (signal.aborted) failed++;
  const cleanupElapsedMs = evidence.reduce((sum, item) => sum + (item.actual?.cleanup?.elapsedMs ?? 0) + (item.recovered?.elapsedMs ?? 0) + (item.recovery?.elapsedMs ?? 0), 0);
  return { id: suite.id, tier: suite.tier, status: failed === 0 && cleanupConfirmed ? 'passed' : 'failed', reasons: failed ? ['canary-expectation-failed'] : cleanupConfirmed ? [] : ['cleanup-failed'],
    counts: { total: passed + failed, passed, failed, skipped: 0 }, process: null, cleanup: { confirmed: cleanupConfirmed, elapsedMs: cleanupElapsedMs }, reportSha256: digest(JSON.stringify(evidence)),
    startedAt, finishedAt: now(), canaries: evidence };
}
