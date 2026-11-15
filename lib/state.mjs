import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OpsError, requireThat, object, textValue, integer, digest, now } from './core.mjs';
import { atomicJson, linuxPermission, noLinks, readJson, secureDirectory, within, syncDirectory } from './filesystem.mjs';

function validateRun(value) {
  object(value, ['schemaVersion', 'key', 'runId', 'phase', 'startedAt', 'finishedAt', 'result']);
  requireThat(value.schemaVersion === 1 && /^[a-f0-9]{64}$/u.test(value.key), '运行状态损坏', 70);
  requireThat(/^run_[a-f0-9-]{36}$/u.test(value.runId), '运行身份损坏', 70);
  requireThat(['running', 'completed', 'failed', 'needs-operator'].includes(value.phase), '运行阶段损坏', 70);
  requireThat(Number.isFinite(Date.parse(value.startedAt)), '运行时间损坏', 70);
  if (value.phase === 'completed') {
    requireThat(value.result?.exitCode === 0 && Array.isArray(value.result.evidence) && value.result.runId === value.runId, '成功状态证据损坏', 70);
  }
  return value;
}

export class RunStore {
  constructor(root) { this.root = path.resolve(root); }

  async initialize() { await secureDirectory(this.root); }

  async load(key) {
    requireThat(/^[a-f0-9]{64}$/u.test(key), '状态键无效', 70);
    const target = within(this.root, path.join(this.root, `${key}.json`));
    try { await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const record = validateRun(await readJson(target, 1048576, process.platform === 'linux' ? { uid: process.getuid(), mode: 0o600 } : undefined));
      requireThat(record.key === key, '持久运行状态键不匹配', 70);
      return record;
    } catch { throw new OpsError(70, '持久运行状态损坏'); }
  }

  async begin(operation, id) {
    await this.initialize();
    const key = digest(operation);
    const previous = await this.load(key);
    if (previous?.phase === 'completed') return { equivalent: true, original: previous.result, key };
    requireThat(previous === null, '存在未恢复运行，需人工核对', 30);
    const record = { schemaVersion: 1, key, runId: id, phase: 'running', startedAt: now(), finishedAt: null, result: null };
    await atomicJson(path.join(this.root, `${key}.json`), record);
    return { equivalent: false, key, record };
  }

  async finish(key, result) {
    const previous = await this.load(key);
    requireThat(previous?.phase === 'running' && previous.runId === result.runId, '运行状态迁移冲突', 70);
    const record = { ...previous, phase: result.exitCode === 0 ? 'completed' : 'failed', finishedAt: now(), result };
    validateRun(record);
    await atomicJson(path.join(this.root, `${key}.json`), record);
  }
}

export async function processIdentity(pid = process.pid) {
  requireThat(process.platform === 'linux', '该平台不支持可验证的锁恢复', 10);
  const bootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  requireThat(/^[a-f0-9-]{36}$/u.test(bootId) && /^\d+$/u.test(startTicks), '无法核对进程身份', 70);
  return `${bootId}:${startTicks}`;
}

export async function processAlive(pid, identity) {
  try { return (await processIdentity(pid)) === identity; } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw new OpsError(30, '进程存活性未知，拒绝恢复锁');
  }
}

function validateLease(value) {
  object(value, ['schemaVersion', 'lockId', 'runId', 'command', 'actor', 'pid', 'processIdentity', 'startedAt', 'heartbeatAt', 'expiresAt']);
  requireThat(value.schemaVersion === 1, '锁版本损坏', 70);
  for (const key of ['lockId', 'runId', 'command', 'actor', 'processIdentity']) textValue(value[key]);
  integer(value.pid, 1, 2147483647);
  for (const key of ['startedAt', 'heartbeatAt', 'expiresAt']) requireThat(Number.isFinite(Date.parse(value[key])), '锁时间损坏', 70);
  requireThat(Date.parse(value.startedAt) <= Date.parse(value.heartbeatAt) && Date.parse(value.heartbeatAt) < Date.parse(value.expiresAt), '锁租约损坏', 70);
  return value;
}

export class LeaseLock {
  constructor(root, name, { leaseMs = 30000, heartbeatMs = 5000, alive = processAlive, identity = processIdentity } = {}) {
    requireThat(/^[a-z][a-z-]{0,63}$/u.test(name), '锁名称无效', 70);
    integer(leaseMs, 500, 300000);
    integer(heartbeatMs, 50, Math.floor(leaseMs / 2));
    this.root = path.resolve(root);
    this.directory = path.join(this.root, name);
    this.leaseMs = leaseMs;
    this.heartbeatMs = heartbeatMs;
    this.alive = alive;
    this.identity = identity;
    this.pending = Promise.resolve();
  }

  async read() {
    try {
      if (process.platform === 'linux') linuxPermission(await fs.lstat(this.directory), { uid: process.getuid(), mode: 0o700, directory: true });
      return validateLease(await readJson(path.join(this.directory, 'lease.json'), 16384, process.platform === 'linux' ? { uid: process.getuid(), mode: 0o600 } : undefined));
    }
    catch { throw new OpsError(70, '锁文件损坏，保留现场'); }
  }

  async recover(canRecover) {
    const guard = `${this.directory}.recovery`;
    try { await fs.mkdir(guard, { mode: 0o700 }); } catch { throw new OpsError(30, '锁恢复正在进行'); }
    try {
      const old = await this.read();
      requireThat(Date.parse(old.expiresAt) < Date.now() && !await this.alive(old.pid, old.processIdentity), '锁未过期或进程仍存活', 30);
      requireThat(await canRecover(old), '实际运行状态不允许自动恢复', 30);
      const current = await this.read();
      requireThat(JSON.stringify(old) === JSON.stringify(current), '锁恢复发生竞争', 30);
      // 保留孤儿租约，不把删除锁当成发布或恢复已成功。
      await fs.rename(this.directory, `${this.directory}.orphan-${randomUUID()}`);
      await syncDirectory(this.root);
    } finally { await fs.rmdir(guard); }
  }

  async acquire(id, command, { canRecover = async () => false } = {}) {
    await secureDirectory(this.root);
    await noLinks(this.directory, { missing: true });
    let created = false;
    try { await fs.mkdir(this.directory, { mode: 0o700 }); created = true; } catch (error) {
      requireThat(error.code === 'EEXIST', '无法创建变更锁', 30);
    }
    if (!created) {
      await this.recover(canRecover);
      try { await fs.mkdir(this.directory, { mode: 0o700 }); } catch { throw new OpsError(30, '变更锁已被接管'); }
    }
    this.lease = { schemaVersion: 1, lockId: randomUUID(), runId: id, command, actor: `uid:${process.getuid?.() ?? 'unsupported'}`, pid: process.pid, processIdentity: await this.identity(), startedAt: now(), heartbeatAt: now(), expiresAt: new Date(Date.now() + this.leaseMs).toISOString() };
    await atomicJson(path.join(this.directory, 'lease.json'), this.lease);
    this.timer = setInterval(() => {
      this.pending = this.pending.then(() => this.heartbeat()).catch(error => { this.failure = error; });
    }, this.heartbeatMs);
    return this;
  }

  async heartbeat() {
    this.assert();
    const current = await this.read();
    requireThat(current.lockId === this.lease.lockId, '变更锁持有者发生变化', 70);
    this.lease = { ...this.lease, heartbeatAt: now(), expiresAt: new Date(Date.now() + this.leaseMs).toISOString() };
    await atomicJson(path.join(this.directory, 'lease.json'), this.lease);
  }

  assert() { if (this.failure) throw new OpsError(70, '锁心跳失败，禁止继续'); }

  async release() {
    clearInterval(this.timer);
    await this.pending;
    this.assert();
    const current = await this.read();
    requireThat(current.lockId === this.lease.lockId, '拒绝释放其他进程的锁', 70);
    await fs.unlink(path.join(this.directory, 'lease.json'));
    await fs.rmdir(this.directory);
    await syncDirectory(this.root);
  }
}
