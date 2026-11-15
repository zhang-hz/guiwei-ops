import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OpsError, requireThat, parseJson, relativePath } from './core.mjs';

export function within(root, target) {
  const relative = path.relative(root, target);
  requireThat(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), '文件路径越界', 10);
  return target;
}

export async function noLinks(target, { missing = false } = {}) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) {
      if (missing && error.code === 'ENOENT') return;
      throw new OpsError(10, '路径缺失或无法检查');
    }
    requireThat(!stat.isSymbolicLink(), '拒绝符号链接路径', 10);
  }
}

export async function secureDirectory(target) {
  await noLinks(target, { missing: true });
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  await noLinks(target);
  const stat = await fs.stat(target);
  requireThat(stat.isDirectory(), '状态目录类型无效', 10);
  if (process.platform === 'linux') {
    requireThat(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, '状态目录owner或mode不安全', 10);
  }
}

export function linuxPermission(stat, { uid = 0, mode = 0o600, directory = false } = {}) {
  requireThat(process.platform === 'linux', '当前平台不能证明Linux owner/mode', 10);
  requireThat((directory ? stat.isDirectory() : stat.isFile()) && !stat.isSymbolicLink(), '宿主文件类型无效', 10);
  requireThat(stat.uid === uid && (stat.mode & 0o777) === mode && (directory || stat.nlink === 1), '宿主owner或mode不合规', 10);
}

export async function readFileBounded(target, maxBytes = 1048576, permission) {
  await noLinks(target);
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    requireThat(stat.isFile() && stat.nlink === 1 && stat.size <= maxBytes, '文件类型或大小无效', 10);
    if (permission) linuxPermission(stat, permission);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    requireThat(length <= maxBytes && after.size === length && stat.size === after.size && stat.mtimeMs === after.mtimeMs, '读取文件超限或发生并发修改', 10);
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

export async function readJson(target, maxBytes = 1048576, permission) {
  return parseJson(await readFileBounded(target, maxBytes, permission), maxBytes);
}

export async function repositoryFile(root, relative) {
  relativePath(relative);
  const target = within(root, path.resolve(root, ...relative.split('/')));
  await readFileBounded(target, 16 * 1024 * 1024);
  return target;
}

export async function syncDirectory(directory) {
  if (process.platform !== 'linux') return 'file-fsync-rename';
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  return 'file-directory-fsync-rename';
}

export async function atomicJson(target, value) {
  return atomicBytes(target, Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'));
}

export async function atomicBytes(target, bytes) {
  const directory = path.dirname(target);
  await secureDirectory(directory);
  await noLinks(target, { missing: true });
  try {
    const existing = await fs.lstat(target);
    requireThat(existing.isFile() && existing.nlink === 1, '状态目标必须是普通文件', 10);
    if (process.platform === 'linux') linuxPermission(existing, { uid: process.getuid(), mode: 0o600 });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(directory, `.write-${randomUUID()}`);
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, target);
    return await syncDirectory(directory);
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function removeRunDirectory(root, target) {
  within(root, target);
  requireThat(target !== root && path.basename(target).startsWith('run_'), '清理路径无效', 70);
  await noLinks(target);
  await fs.rm(target, { recursive: true, force: false });
}
