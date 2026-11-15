import { createHash } from 'node:crypto';
import { digest, requireThat } from '../core.mjs';
import { boundedProcess, processSucceeded, restrictedHostEnvironment } from '../process.mjs';

export async function gitBytes(root, args, maxBytes = 8 * 1024 * 1024, { signal, timeoutMs = 30000 } = {}) {
  const env = { ...restrictedHostEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };
  const result = await boundedProcess('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args],
    { env, capture: true, binary: true, outputBytes: maxBytes, signal, timeoutMs });
  requireThat(processSucceeded(result), '无法读取准确Git对象或索引', 40);
  return result.stdout;
}

export function gitText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { requireThat(false, 'Git路径或身份不是有效UTF-8', 10); }
}

export const blobOid = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function parseTree(bytes) {
  return gitText(bytes).split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(record);
    requireThat(match, 'Git tree包含链接、子模块或未知对象', 10);
    return { path: match[3], mode: match[1], oid: match[2] };
  });
}

export function parseIndex(bytes) {
  return gitText(bytes).split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/u.exec(record);
    requireThat(match, 'Git索引包含冲突、链接或未知对象', 10);
    return { path: match[3], mode: match[1], oid: match[2] };
  });
}

export async function gitIdentity(root, readGit = gitBytes) {
  const commitSha = gitText(await readGit(root, ['rev-parse', '--verify', 'HEAD'])).trim();
  requireThat(/^[a-f0-9]{40}$/u.test(commitSha), '源码SHA无效', 10);
  // 后续查询始终使用准确对象，不以第二次可变HEAD查询代替绑定。
  const treeSha = gitText(await readGit(root, ['rev-parse', '--verify', `${commitSha}^{tree}`])).trim();
  requireThat(/^[a-f0-9]{40}$/u.test(treeSha), '源码tree身份无效', 10);
  const treeBytes = await readGit(root, ['ls-tree', '-r', '-z', '--full-tree', treeSha]);
  const indexBytes = await readGit(root, ['ls-files', '--stage', '-z']);
  const namesBytes = await readGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const tree = parseTree(treeBytes);
  const index = parseIndex(indexBytes);
  const names = gitText(namesBytes).split('\0').filter(Boolean).sort();
  const identity = { commitSha, treeSha, treeSha256: digest(treeBytes), indexSha256: digest(indexBytes), namesSha256: digest(JSON.stringify(names)) };
  return { ...identity, identitySha256: digest(JSON.stringify(identity)), tree, index, names };
}
