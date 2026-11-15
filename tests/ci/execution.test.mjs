import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../../lib/core.mjs';
import { boundedProcess, processSucceeded } from '../../lib/process.mjs';
import { scheduleSuites } from '../../lib/ci/scheduler.mjs';
import { containerArguments } from '../../lib/ci/docker.mjs';
import { createSnapshot, sourcePath, inventorySource } from '../../lib/ci/source.mjs';
import { repositoryModel, cases as sourceCases } from './source.test.mjs';
import { cases as canaryCases } from './canary-verdict.test.mjs';
import { cases as evidenceCases } from './evidence.test.mjs';
import { loadRegistry } from '../../lib/ci/registry.mjs';
import { suite, suiteResult } from './fixtures.mjs';
import { judgeSuite } from '../../lib/ci/report.mjs';

export const cases = [
  ...sourceCases, ...canaryCases, ...evidenceCases,
  ['源码清单拒凭据目录路径逃逸和超长名字', () => {
    assert.equal(sourcePath('tests/ci/fixtures.mjs'), 'tests/ci/fixtures.mjs');
    assert.equal(sourcePath('.env.example'), '.env.example');
    for (const value of ['../escape', '/root/file', 'tests/../escape', 'a\\b', '.git/config', 'tools/nested/.git/config', '.env', '.env.local', '.ssh/id_rsa', '.aws/credentials', 'private.key', 'x'.repeat(513)]) assert.throws(() => sourcePath(value));
  }],
  ['实际快照只复制声明文件并拒绝内容漂移链接及越界', async () => {
    const directory = await fs.mkdtemp('/tmp/control-source-');
    const root = path.join(directory, 'input');
    await fs.mkdir(root);
    const bytes = Buffer.from('synthetic source');
    await fs.writeFile(path.join(root, 'source.mjs'), bytes);
    await fs.writeFile(path.join(root, '.env'), 'synthetic excluded value');
    const options = { readGit: repositoryModel(root, bytes).readGit };
    const inventory = await inventorySource(root, options);
    try {
      const destination = path.join(directory, 'snapshot');
      await createSnapshot(inventory, destination, options);
      assert.deepEqual(await fs.readdir(destination), ['source.mjs']);
      assert.equal((await fs.stat(path.join(destination, 'source.mjs'))).mode & 0o777, 0o444);
      await fs.writeFile(path.join(root, 'source.mjs'), 'changed');
      await assert.rejects(() => createSnapshot(inventory, path.join(directory, 'changed'), options));
      await fs.unlink(path.join(root, 'source.mjs'));
      await fs.symlink(path.join(root, '.env'), path.join(root, 'source.mjs'));
      await assert.rejects(() => createSnapshot(inventory, path.join(directory, 'linked'), options));
      await assert.rejects(() => createSnapshot({ ...inventory, files: [{ ...inventory.files[0], path: '../escape' }] }, path.join(directory, 'escape'), options));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }],
  ['registry加载实际文件拒缺文件与链接', async () => {
    const directory = await fs.mkdtemp('/tmp/control-registry-');
    const item = suite('a');
    try {
      await fs.mkdir(path.join(directory, 'tools/ci'), { recursive: true });
      await fs.mkdir(path.join(directory, 'tests'), { recursive: true });
      await fs.writeFile(path.join(directory, 'tools/ci/suite-registry.json'), JSON.stringify({ schemaVersion: 1, reportVersion: 1, suites: [item] }));
      await assert.rejects(() => loadRegistry(directory));
      for (const file of [item.files[0], item.adapter.entrypoint]) {
        await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
        await fs.writeFile(path.join(directory, file), 'synthetic');
      }
      assert.equal((await loadRegistry(directory)).registry.suites[0].id, 'a');
      await fs.unlink(path.join(directory, item.files[0]));
      await fs.symlink(path.join(directory, item.adapter.entrypoint), path.join(directory, item.files[0]));
      await assert.rejects(() => loadRegistry(directory));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }],
  ['真实非零退出不能被成功报告掩盖', async () => {
    const actual = await boundedProcess(process.execPath, ['--eval', 'process.exitCode=9']);
    assert.equal(actual.exitCode, 9);
    assert.equal(processSucceeded(actual), false);
    assert.equal(judgeSuite(actual, { total: 1, passed: 1, failed: 0, skipped: 0 }, { confirmed: true }).status, 'failed');
  }],
  ['输出上限和硬超时结束真实子进程', async () => {
    const overflow = await boundedProcess(process.execPath, ['--eval', 'setInterval(()=>process.stdout.write("x".repeat(8192)),0)'], { outputBytes: 1024, timeoutMs: 3000 });
    assert.equal(overflow.overflow, true);
    const timeout = await boundedProcess(process.execPath, ['--eval', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
    assert.equal(timeout.timedOut, true);
    assert.equal(processSucceeded(timeout), false);
  }],
  ['SIGTERM与SIGINT真实信号不可记成功', async () => {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      const value = await boundedProcess(process.execPath, ['--eval', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { onStdout: (_, child) => child.kill(signal), timeoutMs: 3000 });
      assert.equal(value.signal, signal);
      assert.equal(processSucceeded(value), false);
    }
  }],
  ['依赖失败后阻断分支且独立suite继续', async () => {
    const selected = [suite('a'), suite('b', { dependsOn: ['a'] }), suite('c')];
    const called = [];
    const values = await scheduleSuites(selected, async item => { called.push(item.id); return { ...suiteResult(item.id), status: item.id === 'a' ? 'failed' : 'passed' }; });
    assert.deepEqual(called, ['a', 'c']);
    assert.deepEqual(values.map(item => item.status), ['failed', 'blocked', 'passed']);
  }],
  ['清理失败与信号取消失败关闭', async () => {
    assert.equal(judgeSuite({ exitCode: 0 }, { total: 1, passed: 1, failed: 0, skipped: 0 }, { confirmed: false }).status, 'failed');
    const controller = new AbortController();
    controller.abort();
    const result = await scheduleSuites([suite('a')], () => { throw new Error('不应执行'); }, { signal: controller.signal });
    assert.equal(result[0].status, 'blocked');
  }],
  ['Docker参数只读非root无网络且不传socket', () => {
    const value = containerArguments(suite('a'), { source: '/tmp/source', name: 'fixed-test', volume: 'fixed-out', runId: 'run_00000000-0000-4000-8000-000000000000', image: 'node@sha256:' + 'a'.repeat(64), seed: '1729' }, 'a'.repeat(64), 1000, 1000);
    assert.ok(value.includes('--read-only') && value.includes('--cap-drop=ALL'));
    assert.equal(value[value.indexOf('--network') + 1], 'none');
    assert.ok(value.includes('CI=true'));
    assert.equal(value.some(item => item.includes('docker.sock') || item.includes('SSH_AUTH_SOCK') || item.includes('LD_PRELOAD') || item.includes('NODE_OPTIONS')), false);
    assert.throws(() => containerArguments(suite('a'), { source: '/tmp/source' }, 'a'.repeat(64), 0, 0));
  }],
];
