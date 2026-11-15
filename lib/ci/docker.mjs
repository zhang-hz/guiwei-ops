import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { digest, now, OpsError, parseJson, requireThat } from '../core.mjs';
import { processSucceeded } from '../process.mjs';
import { adapterEnvironment } from './environment.mjs';
import { validateAdapterReport, judgeSuite } from './report.mjs';
import { dockerCommand, verifyRuntime } from './runtime.mjs';
import { terminalRun } from './canary-verdict.mjs';

const emptyProcess = () => ({ exitCode: null, signal: null, timedOut: false, overflow: false, interrupted: false, cleanupFailed: false, outputBytes: 0, outputSha256: digest('') });
const absentInspection = result => result.exitCode === 1 && !result.signal && !result.timedOut && !result.overflow && !result.interrupted && !result.cleanupFailed;
export const engineState = value => ({ containerId: value.Id, status: value.State.Status, running: value.State.Running, startedAt: value.State.StartedAt,
  finishedAt: value.State.FinishedAt, exitCode: value.State.ExitCode, oomKilled: value.State.OOMKilled, error: value.State.Error });

export function containerArguments(suite, context, nonce, uid, gid) {
  requireThat(uid > 0 && gid >= 0, 'adapter禁止以root运行', 10);
  requireThat(!/[,\r\n\0]/u.test(context.source) && path.isAbsolute(context.source), '容器挂载路径无效', 10);
  const environment = adapterEnvironment({ runId: context.runId, suiteId: suite.id, nonce, files: suite.selectedFiles ?? suite.files, scopes: suite.selectedScopes ?? [], seed: context.seed });
  const args = ['create', '--name', context.name, '--label', `guiwei.ci.run=${context.runId}`, '--label', `guiwei.ci.suite=${suite.id}`,
    '--pull=never', '--user', `${uid}:${gid}`, '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges=true',
    '--network', 'none', '--ipc', 'none', '--pids-limit', String(suite.resources.pids), '--cpus', String(suite.resources.cpus),
    '--memory', `${suite.resources.memoryMb}m`, '--memory-swap', `${suite.resources.memoryMb}m`,
    '--ulimit', `fsize=${suite.resources.outputBytes}:${suite.resources.outputBytes}`, '--ulimit', 'nofile=256:256', '--ulimit', 'core=0:0',
    '--log-driver', 'none', '--stop-timeout', '1', '--workdir', '/src',
    '--tmpfs', `/tmp:rw,noexec,nosuid,nodev,size=${Math.min(suite.resources.memoryMb, 128)}m,mode=1777`,
    '--mount', `type=bind,src=${context.source},dst=/src,readonly,bind-recursive=disabled`,
    '--mount', `type=volume,src=${context.volume},dst=/out,volume-nocopy`];
  // env -i 排除镜像默认变量、HOSTNAME和宿主环境，只保留冻结白名单。
  args.push('--entrypoint', '/usr/bin/env', context.image, '-i');
  for (const [key, value] of Object.entries(environment)) args.push(`${key}=${value}`);
  args.push('/usr/local/bin/node', '--', `/src/${suite.adapter.entrypoint}`, ...suite.adapter.args);
  return args;
}

export class DockerBackend {
  constructor(runtime) { this.runtime = runtime; this.command = dockerCommand(runtime); }

  async preflight() {
    this.identity = await verifyRuntime(this.runtime, this.command);
    return this.identity;
  }

  async inspect(name, timeoutMs = 10000) {
    const result = await this.command(['inspect', '--type', 'container', name], { capture: true, timeoutMs });
    if (!processSucceeded(result)) return { available: false, result };
    try {
      const values = JSON.parse(result.stdout);
      requireThat(values.length === 1 && values[0].Name === `/${name}`, '容器身份响应无效', 70);
      return { available: true, value: values[0], result };
    } catch { throw new OpsError(70, '无法解析容器状态'); }
  }

  async cleanup(context, deadlineMs, { beforeRemove } = {}) {
    const started = Date.now();
    const deadline = started + deadlineMs;
    const remaining = () => { requireThat(Date.now() < deadline, '清理超过独立截止时间', 50); return deadline - Date.now(); };
    let confirmed = false;
    let removed = true;
    let listed = true;
    const inspections = [];
    const errors = [];
    try {
      for (const name of [context.name, `${context.name}-holder`]) {
        const before = await this.inspect(name, remaining());
        let terminal = before;
        if (before.available && before.value.State.Running) {
          const killed = await this.command(['kill', '--signal', 'KILL', name], { timeoutMs: remaining() });
          if (!processSucceeded(killed)) errors.push('engine-kill-failed');
          do {
            terminal = await this.inspect(name, remaining());
            if (!terminal.available || !terminal.value.State.Running) break;
            await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining())));
          } while (true);
        }
        if (before.available && Date.parse(before.value.State.StartedAt) > 0 && (!terminal.available || !terminalRun(engineState(terminal.value)))) errors.push('engine-terminal-invalid');
        if (name === context.name && beforeRemove) {
          try { await beforeRemove(terminal, remaining); } catch { errors.push('evidence-controller-error'); }
        }
        const removal = await this.command(['rm', '--force', '--volumes', name], { timeoutMs: remaining() });
        const listing = await this.command(['ps', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], { capture: true, timeoutMs: remaining() });
        const inspection = await this.inspect(name, remaining());
        removed &&= processSucceeded(removal) || !before.available && absentInspection(before.result) && absentInspection(removal);
        listed &&= processSucceeded(listing) && listing.stdout.trim() === '';
        inspections.push({ name, observed: before.available ? engineState(before.value) : null, terminal: terminal.available ? engineState(terminal.value) : null,
          absent: !inspection.available && absentInspection(inspection.result) });
      }
      const volumeBefore = await this.command(['volume', 'inspect', context.volume], { capture: true, timeoutMs: remaining() });
      const volumeRemoval = await this.command(['volume', 'rm', context.volume], { timeoutMs: remaining() });
      const volumes = await this.command(['volume', 'ls', '--filter', `name=^${context.volume}$`, '--format', '{{.Name}}'], { capture: true, timeoutMs: remaining() });
      const volumeInspect = await this.command(['volume', 'inspect', context.volume], { capture: true, timeoutMs: remaining() });
      removed &&= processSucceeded(volumeRemoval) || absentInspection(volumeBefore) && absentInspection(volumeRemoval);
      listed &&= processSucceeded(volumes) && volumes.stdout.trim() === '';
      confirmed = removed && listed && inspections.every(item => item.absent) && absentInspection(volumeInspect) && errors.length === 0 && Date.now() <= deadline;
    } catch { confirmed = false; errors.push('cleanup-controller-error'); }
    return { confirmed, elapsedMs: Date.now() - started, removed, absentFromEngine: listed, containers: inspections, errors };
  }

  async verifyAbsent(context, deadlineMs) {
    const deadline = Date.now() + deadlineMs;
    const remaining = () => { requireThat(Date.now() < deadline, '回收复核超过截止时间', 50); return deadline - Date.now(); };
    try {
      for (const name of [context.name, `${context.name}-holder`]) {
        const inspection = await this.inspect(name, remaining());
        const listing = await this.command(['ps', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], { capture: true, timeoutMs: remaining() });
        if (inspection.available || !absentInspection(inspection.result) || !processSucceeded(listing) || listing.stdout.trim() !== '') return false;
      }
      const volumes = await this.command(['volume', 'ls', '--filter', `name=^${context.volume}$`, '--format', '{{.Name}}'], { capture: true, timeoutMs: remaining() });
      return processSucceeded(volumes) && volumes.stdout.trim() === '' && Date.now() <= deadline;
    } catch { return false; }
  }

  async prepareOutput(suite, context, uid, gid, remaining, signal) {
    const volume = await this.command(['volume', 'create', '--driver', 'local', '--label', `guiwei.ci.run=${context.runId}`,
      '--opt', 'type=tmpfs', '--opt', 'device=tmpfs', '--opt', `o=size=${Math.max(1048576, suite.resources.outputBytes * 2)},nr_inodes=256,uid=${uid},gid=${gid},mode=0700,nosuid,nodev,noexec`, context.volume], { capture: true, timeoutMs: remaining(), signal });
    requireThat(processSucceeded(volume) && volume.stdout.trim() === context.volume, '无法创建有界输出卷', 40);
    const created = await this.command(['create', '--name', `${context.name}-holder`, '--label', `guiwei.ci.run=${context.runId}`, '--pull=never', '--user', `${uid}:${gid}`,
      '--read-only', '--network', 'none', '--ipc', 'none', '--cap-drop=ALL', '--security-opt', 'no-new-privileges=true', '--memory', '64m', '--memory-swap', '64m', '--cpus', '1', '--pids-limit', '16',
      '--log-driver', 'none', '--mount', `type=volume,src=${context.volume},dst=/out,readonly,volume-nocopy`, '--entrypoint', '/usr/bin/env', this.runtime.image, '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
      '/usr/local/bin/node', '--eval', 'setInterval(() => {}, 1000)'], { capture: true, timeoutMs: remaining(), signal });
    requireThat(processSucceeded(created), '输出卷保留容器创建失败', 40);
    const started = await this.command(['start', `${context.name}-holder`], { timeoutMs: remaining(), signal });
    requireThat(processSucceeded(started), '输出卷保留容器启动失败', 40);
    const version = await this.command(['exec', `${context.name}-holder`, '/usr/bin/env', '-i', '/usr/local/bin/node', '--version'], { capture: true, timeoutMs: remaining(), signal });
    requireThat(processSucceeded(version) && version.stdout.trim() === this.runtime.nodeVersion, '镜像内实际Node版本不匹配', 10);
  }

  async readReport(context, uid, remaining) {
    // 由只读保留容器读取已退出adapter的卷；代码固定，报告不能选择路径或执行命令。
    const reader = "const f=require('fs');let h;let p={invalid:true};try{h=f.openSync('/out/report.json',f.constants.O_RDONLY|f.constants.O_NOFOLLOW|f.constants.O_NONBLOCK);const s=f.fstatSync(h);if(s.isFile()&&s.nlink===1&&s.size<=1048576){const b=Buffer.alloc(1048577);let n=0,r;while(n<b.length&&(r=f.readSync(h,b,n,b.length-n,n))>0)n+=r;const a=f.fstatSync(h);if(n<=1048576&&n===s.size&&a.size===s.size&&a.mtimeMs===s.mtimeMs&&a.nlink===1)p={uid:s.uid,mode:s.mode&511,nlink:s.nlink,bytes:b.subarray(0,n).toString('base64')};}}catch(e){if(!['ENOENT','ELOOP','EISDIR','ENOTDIR'].includes(e.code))throw e;}finally{if(h!==undefined)f.closeSync(h);}process.stdout.write(JSON.stringify(p));";
    const result = await this.command(['exec', `${context.name}-holder`, '/usr/bin/env', '-i', '/usr/local/bin/node', '--eval', reader], { capture: true, outputBytes: 1500000, timeoutMs: remaining() });
    requireThat(processSucceeded(result), '固定报告读取器执行失败', 70);
    const payload = parseJson(result.stdout, 1500000);
    if (payload.invalid === true && Object.keys(payload).length === 1) return { invalid: true };
    if (payload.uid !== uid || payload.mode !== 0o600 || payload.nlink !== 1 || typeof payload.bytes !== 'string') return { invalid: true };
    const bytes = Buffer.from(payload.bytes, 'base64');
    requireThat(bytes.toString('base64') === payload.bytes, 'adapter报告编码无效', 50);
    try { return { report: parseJson(bytes), sha256: digest(bytes) }; }
    catch (error) { if (error instanceof OpsError) return { invalid: true, sha256: digest(bytes) }; throw error; }
  }

  async execute(suite, context, { signal, timeoutMs, onStdout } = {}) {
    const startedAt = now();
    const deadline = Date.now() + Math.min(suite.timeoutMs, timeoutMs ?? suite.timeoutMs);
    const remaining = () => { requireThat(Date.now() < deadline, 'suite执行超过硬截止时间', 50); return deadline - Date.now(); };
    const nonce = randomBytes(32).toString('hex');
    let processResult = emptyProcess();
    let counts = null;
    let reportSha256 = null;
    let inspectEvidence = null;
    const reasons = new Set();
    let actual = null;
    let attached = false;
    let cleanup = { confirmed: false, elapsedMs: 0 };
    const uid = process.getuid() === 0 ? 65534 : process.getuid();
    const gid = process.getuid() === 0 ? 65534 : process.getgid();
    try {
      requireThat(!signal?.aborted, '运行已取消', 50);
      await this.prepareOutput(suite, context, uid, gid, remaining, signal);
      const creation = await this.command(containerArguments(suite, { ...context, image: this.runtime.image }, nonce, uid, gid), { timeoutMs: remaining(), signal, capture: true });
      // 即使create超时也按确定性名字清理，不能遗漏Engine已创建但CLI未返回的容器。
      processResult = { ...creation, stdout: undefined };
      requireThat(processSucceeded(creation) && /^[a-f0-9]{64}\s*$/u.test(creation.stdout), '容器创建失败', 40);
      const before = await this.inspect(context.name, remaining());
      requireThat(before.available && before.value.Id === creation.stdout.trim(), 'Engine创建身份与查询不一致', 70);
      requireThat(before.available && before.value.Config.Labels?.['guiwei.ci.run'] === context.runId && before.value.Config.Labels?.['guiwei.ci.suite'] === suite.id, 'Engine容器标签身份不匹配', 70);
      requireThat(before.value.Image === this.identity.imageId && before.value.HostConfig.NetworkMode === 'none' && before.value.HostConfig.ReadonlyRootfs === true, '实际容器隔离配置不匹配', 10);
      actual = before.value;
      requireThat(actual.Config.User === `${uid}:${gid}` && actual.HostConfig.Privileged === false && actual.HostConfig.CapDrop?.includes('ALL')
        && actual.HostConfig.SecurityOpt?.includes('no-new-privileges=true') && actual.HostConfig.PidMode === '' && actual.HostConfig.IpcMode === 'none'
        && actual.HostConfig.PidsLimit === suite.resources.pids && actual.HostConfig.Memory === suite.resources.memoryMb * 1048576
        && actual.HostConfig.NanoCpus === suite.resources.cpus * 1000000000, '实际权限或资源限制不匹配', 10);
      requireThat(actual.Mounts.length === 2 && actual.Mounts.some(mount => mount.Destination === '/src' && mount.Type === 'bind' && mount.Source === context.source && mount.RW === false)
        && actual.Mounts.some(mount => mount.Destination === '/out' && mount.Type === 'volume' && mount.Name === context.volume && mount.RW === true), '实际容器挂载不匹配', 10);
      processResult = await this.command(['start', '--attach', context.name], { timeoutMs: remaining(), outputBytes: suite.resources.outputBytes, signal, onStdout });
      attached = true;
      if (Date.now() >= deadline && !processResult.overflow && !processResult.interrupted) processResult.timedOut = true;
      if (!processResult.timedOut && !processResult.overflow && !processResult.interrupted && processResult.exitCode !== 0) reasons.add('docker-client-exit');
    } catch (error) {
      reasons.add(error instanceof OpsError ? `control-exit-${error.code}` : 'controller-error');
      if (signal?.aborted) processResult.interrupted = true;
      if (Date.now() >= deadline) processResult.timedOut = true;
    } finally {
      // 执行上限结束后以独立清理期限取得真实终态；不再启动adapter或延长其执行。
      cleanup = await this.cleanup(context, suite.cleanupTimeoutMs, { beforeRemove: async (terminal, cleanupRemaining) => {
        if (!terminal.available) { reasons.add('engine-state-missing'); return; }
        const state = engineState(terminal.value);
        inspectEvidence = { ...state, isolation: actual ? { imageId: actual.Image, user: actual.Config.User, network: actual.HostConfig.NetworkMode,
          readonlyRootfs: actual.HostConfig.ReadonlyRootfs, capDrop: actual.HostConfig.CapDrop, securityOpt: actual.HostConfig.SecurityOpt,
          memoryBytes: actual.HostConfig.Memory, nanoCpus: actual.HostConfig.NanoCpus, pids: actual.HostConfig.PidsLimit,
          mounts: actual.Mounts.map(mount => ({ destination: mount.Destination, type: mount.Type, writable: mount.RW })) } : null };
        processResult.cliExitCode = processResult.exitCode;
        processResult.exitCode = state.exitCode;
        if (!actual || terminal.value.Id !== actual.Id || terminal.value.Config.Labels?.['guiwei.ci.run'] !== context.runId
          || terminal.value.Config.Labels?.['guiwei.ci.suite'] !== suite.id) reasons.add('engine-identity-mismatch');
        if (!terminalRun(state)) reasons.add('engine-terminal-invalid');
        if (state.oomKilled) reasons.add('memory-limit');
        if (state.error !== '') reasons.add('engine-error');
        if (!attached) reasons.add('adapter-not-attached');
        if (!attached || !terminalRun(state) || processResult.timedOut || processResult.overflow || processResult.interrupted) return;
        try {
          const report = await this.readReport(context, uid, cleanupRemaining);
          reportSha256 = report.sha256 ?? null;
          if (report.invalid) reasons.add('report-invalid');
          else {
            try { counts = validateAdapterReport(report.report, { runId: context.runId, suiteId: suite.id, nonce }); }
            catch (error) { if (error instanceof OpsError) reasons.add('report-invalid'); else throw error; }
          }
        } catch { reasons.add('report-controller-error'); }
      } });
    }
    const judgement = judgeSuite(processResult, counts, cleanup);
    if (reasons.size) { judgement.status = 'failed'; judgement.reasons.push(...reasons); }
    return { id: suite.id, tier: suite.tier, ...judgement, counts, process: processResult, cleanup, reportSha256, startedAt, finishedAt: now(), inspect: inspectEvidence };
  }
}
