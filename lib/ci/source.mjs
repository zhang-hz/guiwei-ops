import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { digest, requireThat, OpsError } from '../core.mjs';
import { noLinks, readFileBounded, secureDirectory, within } from '../filesystem.mjs';
import { blobOid, gitBytes, gitIdentity, gitText } from './source-git.mjs';

const MAX_FILES = 30000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

export function sourcePath(value) {
  requireThat(value.length > 0 && value.length <= 512 && !/[\\\u0000-\u001f\u007f:,]/u.test(value), '源码清单路径无效', 10);
  requireThat(!path.posix.isAbsolute(value) && path.posix.normalize(value) === value, '源码清单路径越界', 10);
  const segments = value.split('/');
  requireThat(!segments.some(segment => ['.', '..', '.git', '.ops-ci', '.ssh', '.aws', '.config', '.codex', '.agents', '.docker', '.azure', '.kube', 'node_modules'].includes(segment)), '源码清单包含受限目录', 10);
  // Git 清单是源集合的权威；这层拒绝敏感载荷，不以猜测扫描器替代清单。
  requireThat(!segments.some(segment => segment === '.env' || segment.startsWith('.env.') && !segment.endsWith('.example') || /\.(?:pem|p12|pfx|key)$/iu.test(segment) || ['id_rsa', 'id_ed25519', 'credentials', 'ossutilconfig'].includes(segment)), '源码清单包含禁止公开的凭据文件', 10);
  return value;
}

export async function inventorySource(root, { readGit = gitBytes } = {}) {
  root = path.resolve(root);
  await noLinks(root);
  requireThat(gitText(await readGit(root, ['rev-parse', '--show-toplevel'])).trim().replaceAll('\\', '/') === root.replaceAll('\\', '/'), '工作目录必须是仓库根', 10);
  const identity = await gitIdentity(root, readGit);
  const { commitSha, treeSha, names } = identity;
  requireThat(names.length > 0 && names.length <= MAX_FILES && new Set(names).size === names.length, '源码清单为空、重复或超限', 10);
  for (const entry of [...identity.tree, ...identity.index]) sourcePath(entry.path);
  const tree = new Map(identity.tree.map(entry => [entry.path, entry]));
  requireThat(tree.size === identity.tree.length && identity.tree.length <= MAX_FILES && identity.index.length <= MAX_FILES, 'Git对象清单重复或超限', 10);
  let dirty = JSON.stringify(identity.tree) !== JSON.stringify(identity.index);
  const files = [];
  const hash = createHash('sha256');
  let totalBytes = 0;
  for (const name of names.sort()) {
    sourcePath(name);
    const absolute = within(root, path.resolve(root, ...name.split('/')));
    let stat;
    try { stat = await fs.lstat(absolute); } catch (error) {
      if (error.code === 'ENOENT') { dirty = true; hash.update(`${name}\0deleted\0`); continue; }
      throw new OpsError(10, '源码文件不存在');
    }
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_FILE_BYTES, '源码链接、嵌套仓库或文件超限', 10);
    const bytes = await readFileBounded(absolute, MAX_FILE_BYTES);
    totalBytes += bytes.length;
    requireThat(totalBytes <= MAX_TOTAL_BYTES, '源码快照超过总量上限', 10);
    const sha256 = digest(bytes);
    const mode = (stat.mode & 0o111) !== 0 ? '100755' : '100644';
    const oid = blobOid(bytes);
    const committed = tree.get(name);
    dirty ||= !committed || committed.mode !== mode || committed.oid !== oid;
    hash.update(`${name}\0${mode}\0${sha256}\0`);
    files.push({ path: name, bytes: bytes.length, sha256, executable: mode === '100755', mode, oid });
  }
  requireThat(files.length > 0, '源码清单没有普通文件', 10);
  const included = new Set(files.map(file => file.path));
  dirty ||= files.length !== identity.tree.length || identity.tree.some(entry => !included.has(entry.path));
  const after = await gitIdentity(root, readGit);
  requireThat(after.identitySha256 === identity.identitySha256, '源码HEAD、索引或文件集合在采集期间漂移', 10);
  const worktreeSha256 = hash.digest('hex');
  const binding = { commitSha, treeSha, indexSha256: identity.indexSha256, namesSha256: identity.namesSha256, worktreeSha256, dirty };
  return { root, ...binding, sha256: digest(JSON.stringify(binding)), gitIdentitySha256: identity.identitySha256, files, totalBytes };
}

export async function assertSourceIdentity(inventory, options) {
  const current = await inventorySource(inventory.root, options);
  requireThat(current.sha256 === inventory.sha256 && current.gitIdentitySha256 === inventory.gitIdentitySha256, '源码身份在冻结后漂移', 10);
}

export async function createSnapshot(inventory, destination, { readGit = gitBytes } = {}) {
  requireThat(inventory.files.length > 0 && inventory.files.length <= MAX_FILES, '源码快照文件数无效', 10);
  requireThat(typeof inventory.gitIdentitySha256 === 'string' && typeof inventory.dirty === 'boolean', '源码快照缺少Git绑定身份', 10);
  await assertSourceIdentity(inventory, { readGit });
  await secureDirectory(destination);
  for (const file of inventory.files) {
    sourcePath(file.path);
    const source = within(inventory.root, path.join(inventory.root, ...file.path.split('/')));
    // clean执行字节和执行位来自固定tree/blob；dirty仅执行已标识的工作树字节。
    const bytes = inventory.dirty ? await readFileBounded(source, MAX_FILE_BYTES) : await readGit(inventory.root, ['cat-file', 'blob', file.oid], MAX_FILE_BYTES);
    requireThat(bytes.length === file.bytes && digest(bytes) === file.sha256, '源码在快照期间发生变化', 10);
    requireThat(blobOid(bytes) === file.oid && file.executable === (file.mode === '100755'), '源码对象或执行位绑定错误', 10);
    if (inventory.dirty) requireThat((((await fs.lstat(source)).mode & 0o111) !== 0) === file.executable, '源码执行位在快照期间漂移', 10);
    const target = within(destination, path.join(destination, ...file.path.split('/')));
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await fs.writeFile(target, bytes, { flag: 'wx', mode: file.executable ? 0o555 : 0o444 });
  }
  await assertSourceIdentity(inventory, { readGit });
  await fs.chmod(destination, 0o755);
  return destination;
}
