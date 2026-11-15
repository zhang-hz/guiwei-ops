import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { blobOid, parseTree, parseIndex } from '../../lib/ci/source-git.mjs';
import { inventorySource, createSnapshot } from '../../lib/ci/source.mjs';

// 单元容器没有Git；此元数据模型只验证消费契约，真实Git由固定父级另外编排。
export function repositoryModel(root, bytes) {
  const oid = blobOid(bytes);
  const model = { head: 'a'.repeat(40), treeSha: 'b'.repeat(40), tree: `100644 blob ${oid}\tsource.mjs\0`,
    index: `100644 ${oid} 0\tsource.mjs\0`, names: 'source.mjs\0', blobs: new Map([[oid, bytes]]), calls: [] };
  model.readGit = async (_root, args) => {
    model.calls.push(args);
    const [command, ...rest] = args;
    if (command === 'rev-parse' && rest[0] === '--show-toplevel') return Buffer.from(root);
    if (command === 'rev-parse' && rest[1] === 'HEAD') return Buffer.from(model.head);
    if (command === 'rev-parse' && rest[1] === `${model.head}^{tree}`) return Buffer.from(model.treeSha);
    if (command === 'ls-tree' && rest.at(-1) === model.treeSha) return Buffer.from(model.tree);
    if (command === 'ls-files') return Buffer.from(rest[0] === '--stage' ? model.index : model.names);
    if (command === 'cat-file' && rest[0] === 'blob') { assert.ok(model.blobs.has(rest[1])); return model.blobs.get(rest[1]); }
    throw new Error('不允许未绑定的Git查询');
  };
  return model;
}

async function fixture(execute) {
  const directory = await fs.mkdtemp('/tmp/control-source-identity-');
  const root = path.join(directory, 'input');
  await fs.mkdir(root);
  const bytes = Buffer.from([0, 255, 13, 10, 65]);
  await fs.writeFile(path.join(root, 'source.mjs'), bytes, { mode: 0o644 });
  const model = repositoryModel(root, bytes);
  try { await execute({ root, directory, bytes, model, options: { readGit: model.readGit } }); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export const cases = [
  ['clean快照按固定blob读取二进制并包含执行位身份', () => fixture(async ({ root, directory, bytes, model, options }) => {
    const inventory = await inventorySource(root, options);
    assert.equal(inventory.dirty, false);
    const destination = path.join(directory, 'snapshot');
    await createSnapshot(inventory, destination, options);
    assert.deepEqual(await fs.readFile(path.join(destination, 'source.mjs')), bytes);
    assert.equal(model.calls.some(args => args[0] === 'cat-file' && args[2] === blobOid(bytes)), true);
    assert.equal(model.calls.some(args => args[0] === 'status'), false);
    await fs.chmod(path.join(root, 'source.mjs'), 0o755);
    const executable = await inventorySource(root, options);
    assert.equal(executable.dirty, true);
    assert.notEqual(executable.sha256, inventory.sha256);
    assert.notEqual(executable.worktreeSha256, inventory.worktreeSha256);
    await assert.rejects(() => createSnapshot(inventory, path.join(directory, 'drift'), options));
  })],
  ['local内容增删和索引修改均准确标dirty', () => fixture(async ({ root, model, options }) => {
    const baseline = await inventorySource(root, options);
    await fs.writeFile(path.join(root, 'source.mjs'), 'changed');
    assert.equal((await inventorySource(root, options)).dirty, true);
    model.index = model.index.replace(blobOid(model.blobs.values().next().value), 'c'.repeat(40));
    const staged = await inventorySource(root, options);
    assert.equal(staged.dirty, true);
    assert.notEqual(staged.indexSha256, baseline.indexSha256);
    await fs.writeFile(path.join(root, 'added.mjs'), 'new');
    model.names += 'added.mjs\0';
    assert.equal((await inventorySource(root, options)).dirty, true);
    await fs.unlink(path.join(root, 'source.mjs'));
    const deleted = await inventorySource(root, options);
    assert.equal(deleted.dirty, true);
    assert.deepEqual(deleted.files.map(file => file.path), ['added.mjs']);
  })],
  ['冻结后HEAD索引文件集合改变均拒绝而不是重读status授信', () => fixture(async ({ root, directory, model, options }) => {
    const original = await inventorySource(root, options);
    for (const [field, changed] of [['head', 'c'.repeat(40)], ['index', model.index.replace('100644', '100755')], ['names', model.names + 'added.mjs\0']]) {
      const previous = model[field];
      model[field] = changed;
      await assert.rejects(() => createSnapshot(original, path.join(directory, field), options));
      model[field] = previous;
    }
  })],
  ['采集期间索引漂移及Git非普通对象拒绝', () => fixture(async ({ root, model }) => {
    let indexReads = 0;
    const readGit = async (directory, args, limit) => {
      if (args[0] === 'ls-files' && args[1] === '--stage' && ++indexReads === 2) model.index = model.index.replace('100644', '100755');
      return model.readGit(directory, args, limit);
    };
    await assert.rejects(() => inventorySource(root, { readGit }));
    assert.throws(() => parseTree(Buffer.from(`120000 blob ${'a'.repeat(40)}\tlink\0`)));
    assert.throws(() => parseIndex(Buffer.from(`100644 ${'a'.repeat(40)} 2\tconflict\0`)));
  })],
];
