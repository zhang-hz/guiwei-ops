import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, envelope, now, parseJson, requireThat, safeFailure, VERSION } from '../core.mjs';
import { atomicBytes, atomicJson, noLinks, readFileBounded, secureDirectory, syncDirectory, within } from '../filesystem.mjs';
import { LeaseLock } from '../state.mjs';
import { REGISTRY_PATH, loadRegistry, selectSuites, validatePolicy } from './registry.mjs';
import { inventorySource, createSnapshot, assertSourceIdentity } from './source.mjs';
import { selectorOf } from './arguments.mjs';
import { loadRuntime } from './runtime.mjs';
import { DockerBackend } from './docker.mjs';
import { aggregateSuites, toJUnit } from './report.mjs';
import { scheduleSuites } from './scheduler.mjs';
import { runControlCanary } from './control-canary.mjs';

export async function preflightSelection(controlRoot, sourceRoot, args, targetOverride) {
  const { registry, sha256 } = await loadRegistry(sourceRoot);
  const bytes = await readFileBounded(path.join(controlRoot, 'ci/policy.json'));
  const policy = parseJson(bytes);
  const target = targetOverride ?? (path.resolve(controlRoot) === path.resolve(sourceRoot) ? 'control' : 'application');
  validatePolicy(policy, registry, target);
  const selected = selectSuites(registry, selectorOf(args));
  return { registry, registrySha256: sha256, policy, policySha256: digest(bytes), target, selected };
}

function runnable(suite) {
  requireThat(!['database', 'system', 'e2e', 'nonfunctional'].includes(suite.tier), 'M1尚未实现该层临时资源生命周期', 10);
  requireThat(suite.isolation.network === 'none', 'M1未实现临时服务网络', 10);
}

const sourceIdentity = source => ({ commitSha: source.commitSha, dirty: source.dirty, sha256: source.sha256,
  treeSha: source.treeSha, indexSha256: source.indexSha256, worktreeSha256: source.worktreeSha256 });

async function reserveRun(sourceRoot, id) {
  const root = path.join(sourceRoot, '.ops-ci');
  const runs = path.join(root, 'runs');
  await secureDirectory(root);
  await secureDirectory(runs);
  const directory = path.join(runs, id);
  await noLinks(directory, { missing: true });
  try { await fs.mkdir(directory, { mode: 0o700 }); } catch { requireThat(false, 'runId已存在或运行目录不可创建', 30); }
  await syncDirectory(runs);
  return { root, directory };
}

export async function runCi(controlRoot, sourceRoot, args, id, startedAt, signal, { onReserved = () => {} } = {}) {
  const plan = await preflightSelection(controlRoot, sourceRoot, args);
  if (plan.target === 'control') {
    const canary = plan.registry.suites.find(suite => suite.id === 'control-canary');
    requireThat(canary.adapter.entrypoint === 'tests/ci/canary.mjs' && canary.adapter.args.length === 0 && canary.files.length === 1 && canary.files[0] === 'tests/ci/canary.mjs', '控制canary描述与固定编排不兼容', 50);
  }
  if (args.list || args.explain) {
    return { ...envelope('ci', id, startedAt, 0, '已校验选择计划，未执行测试'), plan: { registryPath: REGISTRY_PATH, target: plan.target, selector: selectorOf(args),
      selected: plan.selected.map(suite => ({ id: suite.id, tier: suite.tier, dependsOn: suite.dependsOn, files: suite.selectedFiles, scopes: suite.selectedScopes, dependency: suite.dependency })),
      qualification: 'm1', partial: true, eligible: false, policySha256: plan.policySha256, registrySha256: plan.registrySha256 } };
  }
  plan.selected.forEach(runnable);
  const control = await inventorySource(controlRoot);
  requireThat(!control.dirty, '执行入口必须来自固定干净控制提交', 10);
  const source = plan.target === 'control' ? control : await inventorySource(sourceRoot);
  requireThat(!args.sha || source.commitSha === args.sha, '实际源码SHA与输入不匹配', 10);
  requireThat(!['pr', 'release', 'extended'].includes(args.profile) || !source.dirty, 'CI profile必须使用干净准确源码', 10);
  const runtime = await loadRuntime(controlRoot);
  const backend = new DockerBackend(runtime);
  const runtimeIdentity = await backend.preflight();
  const reserved = await reserveRun(sourceRoot, id);
  reserved.id = id;
  onReserved(reserved);
  const lock = new LeaseLock(path.join(reserved.root, 'locks'), 'ci-workspace');
  const snapshot = within(reserved.directory, path.join(reserved.directory, 'tmp', 'source'));
  let locked = false;
  let result;
  let temporaryCleaned = false;
  try {
    await lock.acquire(id, 'ci');
    locked = true;
    await atomicJson(path.join(reserved.directory, 'state.json'), { schemaVersion: 1, runId: id, phase: 'running', startedAt, sourceSha256: source.sha256 });
    await secureDirectory(path.dirname(snapshot));
    await createSnapshot(source, snapshot);
    if (plan.target !== 'control') await assertSourceIdentity(control);
    // 必须从本次快照再次解析，不能用检查后的可变工作树执行另一份registry。
    const snapshotPlan = await preflightSelection(controlRoot, snapshot, args, plan.target);
    requireThat(snapshotPlan.registrySha256 === plan.registrySha256 && snapshotPlan.policySha256 === plan.policySha256, 'registry或policy在运行中变化', 10);
    const execute = suite => {
      const context = { runId: id, source: snapshot, seed: '1729', name: `guiwei-ci-${id.slice(4)}-${digest(suite.id).slice(0, 12)}` };
      context.volume = `${context.name}-out`;
      return plan.target === 'control' && suite.id === 'control-canary'
        ? runControlCanary(backend, suite, context, { signal, timeoutMs: args.timeoutMs, controlRoot: snapshot, directory: reserved.directory })
        : backend.execute(suite, context, { signal, timeoutMs: args.timeoutMs });
    };
    const suites = await scheduleSuites(plan.selected, execute, { signal, assertLock: () => lock.assert() });
    const aggregate = aggregateSuites(suites, plan.selected);
    const exitCode = aggregate.status === 'passed' && !signal.aborted ? 0 : 50;
    result = { ...envelope('ci', id, startedAt, exitCode, exitCode === 0 ? '所选M1范围执行成功，资格为partial' : '所选M1范围门禁失败'), ci: {
      cliVersion: VERSION, control: { ...sourceIdentity(control), trustStatus: 'candidate' },
      source: sourceIdentity(source), policy: { version: plan.policy.version, sha256: plan.policySha256 },
      registry: { schemaVersion: 1, reportVersion: 1, sha256: plan.registrySha256 }, selector: selectorOf(args), seed: '1729', suites, counts: aggregate.counts,
      qualification: 'm1', partial: true, eligible: false, runtime: runtimeIdentity,
    } };
  } catch (error) {
    const failure = safeFailure(error);
    result = envelope('ci', id, startedAt, failure.exitCode, failure.summary);
  } finally {
    try {
      const temporary = path.dirname(snapshot);
      within(reserved.directory, temporary);
      await noLinks(temporary, { missing: true });
      await fs.rm(temporary, { recursive: true, force: true });
      temporaryCleaned = true;
    } catch { temporaryCleaned = false; }
    if (locked) {
      try { await lock.release(); } catch { result = { ...result, status: 'failed', exitCode: 70, summary: 'CI工作区锁清理失败' }; }
    }
    if (!temporaryCleaned) result = { ...result, status: 'failed', exitCode: 70, summary: 'CI源码快照清理失败' };
  }
  result.finishedAt = now();
  result.cleanup = { snapshotRemoved: temporaryCleaned };
  reserved.result = result;
  if (result.ci) {
    const junit = Buffer.from(toJUnit({ suites: result.ci.suites }));
    await atomicBytes(path.join(reserved.directory, 'junit.xml'), junit);
    result.evidence.push({ path: `.ops-ci/runs/${id}/junit.xml`, sha256: digest(junit) });
  }
  reserved.state = { schemaVersion: 1, runId: id, phase: result.exitCode === 0 ? 'completed' : 'failed', startedAt, finishedAt: result.finishedAt, exitCode: result.exitCode };
  await atomicJson(path.join(reserved.directory, 'state.json'), reserved.state);
  await atomicJson(path.join(reserved.directory, 'result.json'), result);
  return result;
}
