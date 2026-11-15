import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gitBytes, gitText } from '../../lib/ci/source-git.mjs';
import { inventorySource, createSnapshot } from '../../lib/ci/source.mjs';
import { requireThat } from '../../lib/core.mjs';

// 只由控制目标的固定父级handler调用；不导出可选择宿主命令的应用adapter。
export async function sourceParentCases(temporary, signal, deadline) {
  const evidence = [];
  const directory = await fs.mkdtemp(path.join(temporary, 'source-git-'));
  try {
    for (const mode of ['clean-binary-mode', 'content-drift', 'head-drift', 'index-drift', 'addition', 'deletion', 'mode-drift', 'collection-race']) {
      requireThat(!signal.aborted, 'Git父级反例被取消', 50);
      const root = path.join(directory, mode);
      await fs.mkdir(root);
      const readGit = (directory, args, limit) => gitBytes(directory, args, limit, { signal, timeoutMs: Math.max(1, Math.min(30000, deadline - Date.now())) });
      const options = { readGit };
      const git = args => readGit(root, ['-c', 'user.name=控制反例', '-c', 'user.email=control-fixture@invalid', '-c', 'core.autocrlf=false', '-c', 'core.filemode=true', ...args]);
      let actual = null;
      let accepted = false;
      try {
        await git(['init', '--quiet', '--object-format=sha1']);
        const bytes = Buffer.from([0, 255, 13, 10, 65]);
        await fs.writeFile(path.join(root, 'source.mjs'), bytes, { mode: 0o755 });
        await fs.writeFile(path.join(root, '.gitignore'), '.env\nignored/\ntools/guiwei-ops/\n');
        await fs.writeFile(path.join(root, '.env.example'), 'EXAMPLE=synthetic');
        await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC=excluded');
        await fs.mkdir(path.join(root, 'tools/guiwei-ops'), { recursive: true });
        await fs.writeFile(path.join(root, 'tools/guiwei-ops/nested.txt'), 'excluded');
        await git(['add', '--', 'source.mjs', '.gitignore', '.env.example']);
        await git(['commit', '--quiet', '-m', '固定合成输入']);
        const baseline = await inventorySource(root, options);
        assert.equal(baseline.dirty, false);
        assert.deepEqual(baseline.files.map(file => file.path), ['.env.example', '.gitignore', 'source.mjs']);
        assert.equal(baseline.commitSha, gitText(await git(['rev-parse', 'HEAD'])).trim());
        if (mode === 'clean-binary-mode') {
          const snapshot = path.join(directory, 'clean-snapshot');
          await createSnapshot(baseline, snapshot, options);
          assert.deepEqual(await fs.readFile(path.join(snapshot, 'source.mjs')), bytes);
          assert.equal((await fs.stat(path.join(snapshot, 'source.mjs'))).mode & 0o777, 0o555);
          assert.deepEqual((await fs.readdir(snapshot)).sort(), ['.env.example', '.gitignore', 'source.mjs']);
          actual = { clean: true, snapshotSha256: baseline.sha256, treeSha: baseline.treeSha };
        } else if (mode === 'collection-race') {
          let changed = false;
          const racingRead = async (directory, args, limit) => {
            const value = await readGit(directory, args, limit);
            if (!changed && args[0] === 'ls-files' && args[1] === '--cached') {
              changed = true;
              await fs.writeFile(path.join(root, 'source.mjs'), '并发修改');
            }
            return value;
          };
          const inventory = await inventorySource(root, { readGit: racingRead });
          assert.equal(changed, true);
          assert.equal(inventory.dirty, true);
          assert.notEqual(inventory.sha256, baseline.sha256);
          actual = { clean: false, detectedDirty: true, sourceSha256: inventory.sha256 };
        } else {
          if (mode === 'content-drift' || mode === 'head-drift' || mode === 'index-drift') await fs.writeFile(path.join(root, 'source.mjs'), '已变化的合成源码');
          if (mode === 'index-drift' || mode === 'head-drift') await git(['add', '--', 'source.mjs']);
          if (mode === 'head-drift') await git(['commit', '--quiet', '-m', '另一准确提交']);
          if (mode === 'addition') await fs.writeFile(path.join(root, 'added.mjs'), 'new');
          if (mode === 'deletion') await fs.unlink(path.join(root, 'source.mjs'));
          if (mode === 'mode-drift') await fs.chmod(path.join(root, 'source.mjs'), 0o644);
          const inventory = await inventorySource(root, options);
          assert.equal(inventory.dirty, mode !== 'head-drift');
          assert.notEqual(inventory.sha256, baseline.sha256);
          if (mode === 'deletion') assert.equal(inventory.files.some(file => file.path === 'source.mjs'), false);
          await assert.rejects(() => createSnapshot(baseline, path.join(directory, `${mode}-snapshot`), options));
          actual = { frozenIdentityRejected: true };
        }
        accepted = true;
      } catch { accepted = false; }
      evidence.push({ mode: `git-${mode}`, accepted, actual });
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
  return evidence;
}
