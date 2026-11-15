import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, readJson, readFileBounded } from '../../lib/filesystem.mjs';
import { digest, envelope, now } from '../../lib/core.mjs';
import { RunStore, LeaseLock } from '../../lib/state.mjs';
import { validateConfig, parseSecretDocument, secretEvidence } from '../../lib/config.mjs';

async function temporary(execute) {
  const directory = await fs.mkdtemp('/tmp/control-state-');
  try { await execute(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export const cases = [
  ['状态原子落盘与权限真实检查', () => temporary(async root => {
    const target = path.join(root, 'state.json');
    assert.equal(await atomicJson(target, { phase: 'failed' }), 'file-directory-fsync-rename');
    assert.deepEqual(await readJson(target), { phase: 'failed' });
    const stat = await fs.stat(target);
    assert.equal(stat.uid, process.getuid());
    assert.equal(stat.mode & 0o777, 0o600);
    await fs.chmod(target, 0o666);
    await assert.rejects(() => atomicJson(target, { healthy: true }));
  })],
  ['坏JSON不能当默认状态且等价完成返回原证据', () => temporary(async root => {
    const store = new RunStore(root);
    const id = 'run_00000000-0000-4000-8000-000000000000';
    const first = await store.begin('control:test', id);
    const result = envelope('test', id, now(), 0, '所选范围成功', [{ path: 'original.json', sha256: digest('original') }]);
    await store.finish(first.key, result);
    const repeated = await store.begin('control:test', 'run_11111111-1111-4111-8111-111111111111');
    assert.equal(repeated.equivalent, true);
    assert.deepEqual(repeated.original, result);
    const key = digest('corrupt');
    await fs.writeFile(path.join(root, `${key}.json`), '{', { mode: 0o600 });
    await assert.rejects(() => store.load(key), error => error.code === 70);
  })],
  ['符号链接硬链接与越界不被读取', () => temporary(async root => {
    const target = path.join(root, 'data');
    await fs.writeFile(target, 'synthetic');
    await fs.symlink(target, path.join(root, 'symbolic'));
    await assert.rejects(() => readFileBounded(path.join(root, 'symbolic')));
    await fs.link(target, path.join(root, 'hard'));
    await assert.rejects(() => readFileBounded(target));
  })],
  ['完成记录的内嵌键必须等于请求键', () => temporary(async root => {
    const store = new RunStore(root);
    const id = 'run_00000000-0000-4000-8000-000000000000';
    const first = await store.begin('operation-a', id);
    const result = envelope('test', id, now(), 0, '原操作证据');
    await store.finish(first.key, result);
    await atomicJson(path.join(root, `${digest('operation-b')}.json`), await store.load(first.key));
    await assert.rejects(() => store.begin('operation-b', id), error => error.code === 70);
    assert.deepEqual((await store.begin('operation-a', id)).original, result);
  })],
  ['锁互斥心跳及双条件恢复', () => temporary(async root => {
    const options = { identity: async () => 'test-process', alive: async () => true, leaseMs: 1000, heartbeatMs: 100 };
    const first = await new LeaseLock(root, 'ci-test', options).acquire('first', 'ci');
    try {
      await first.heartbeat();
      await assert.rejects(() => new LeaseLock(root, 'ci-test', options).acquire('second', 'ci'), error => error.code === 30);
    } finally { await first.release(); }
    const orphan = await new LeaseLock(root, 'ci-orphan', options).acquire('orphan', 'ci');
    clearInterval(orphan.timer);
    const old = await orphan.read();
    await atomicJson(path.join(root, 'ci-orphan', 'lease.json'), { ...old, startedAt: new Date(Date.now() - 4000).toISOString(), heartbeatAt: new Date(Date.now() - 3000).toISOString(), expiresAt: new Date(Date.now() - 2000).toISOString() });
    await assert.rejects(() => new LeaseLock(root, 'ci-orphan', options).acquire('next', 'ci', { canRecover: async () => true }), error => error.code === 30);
    const deadOptions = { ...options, alive: async () => false };
    await assert.rejects(() => new LeaseLock(root, 'ci-orphan', deadOptions).acquire('next', 'ci'), error => error.code === 30);
    const next = await new LeaseLock(root, 'ci-orphan', deadOptions).acquire('next', 'ci', { canRecover: async () => true });
    await next.release();
    assert.ok((await fs.readdir(root)).some(name => name.startsWith('ci-orphan.orphan-')));
  })],
  ['环境身份结构与密钥shell语义明确拒绝', () => {
    const config = { schemaVersion: 1, environment: 'production', hostId: 'guiwei-prod-vps', host: '106.15.89.180', domain: 'guiwei.zhanghaozhi.cn', paths: { root: '/srv/guiwei-prod', site: '/srv/guiwei-prod/site', ops: '/srv/guiwei-prod/ops', secrets: '/srv/guiwei-prod/secrets' }, compose: { project: 'guiwei-prod', files: ['/etc/guiwei-prod/compose/production.yml'] } };
    validateConfig(config);
    assert.throws(() => validateConfig({ ...config, domain: 'guiwei.lan' }));
    assert.throws(() => validateConfig({ ...config, paths: { ...config.paths, root: '../prod' } }));
    for (const text of ['ENVIRONMENT=production\nSESSION_SECRET=$(id)', 'ENVIRONMENT=dev\nSESSION_SECRET=' + 'x'.repeat(32), 'ENVIRONMENT=production\nUNKNOWN=abc']) assert.throws(() => parseSecretDocument(text, 'api', 'production'));
    const values = parseSecretDocument('ENVIRONMENT=production\nSESSION_SECRET=' + 'x'.repeat(32), 'api', 'production');
    assert.equal(JSON.stringify(secretEvidence(values)).includes('x'.repeat(32)), false);
  }],
];
