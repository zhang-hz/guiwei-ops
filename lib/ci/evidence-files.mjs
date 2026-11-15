import fs from 'node:fs/promises';
import { constants as c } from 'node:fs';
import path from 'node:path';
import { requireThat } from '../core.mjs';

const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino;
export const EVIDENCE_LIMITS = Object.freeze({ 'envelope.json': 8 * 1048576, 'result.json': 8 * 1048576, 'state.json': 65536, 'junit.xml': 1048576 });
const regular = (s, limit) => s.isFile() && s.nlink === 1 && s.size > 0 && s.size <= limit
  && s.uid === process.getuid() && (s.mode & 0o777) === 0o600;

// Linux目录句柄逐层锚定，应用路径不经过可换链的绝对路径再次打开。
export class EvidenceDirectory {
  constructor() { this.nodes = []; }
  location(name = '') { return `/proc/self/fd/${this.nodes.at(-1).handle.fd}${name ? `/${name}` : ''}`; }

  async append(name, handle) {
    const stat = await handle.stat();
    requireThat(stat.isDirectory() && [0, process.getuid()].includes(stat.uid), '证据父目录类型或owner不安全', 10);
    requireThat((stat.mode & 0o022) === 0 || stat.uid === 0 && (stat.mode & 0o1000) !== 0, '证据父目录可被非可信用户替换', 10);
    this.nodes.push({ name, handle, stat });
  }

  async open(absolute) {
    requireThat(process.platform === 'linux' && path.isAbsolute(absolute) && path.normalize(absolute) === absolute, '证据目录必须是Linux规范绝对路径', 10);
    try {
      await this.append('/', await fs.open('/', c.O_RDONLY | c.O_DIRECTORY | c.O_NOFOLLOW));
      for (const name of absolute.slice(1).split('/').filter(Boolean)) {
        const handle = await fs.open(this.location(name), c.O_RDONLY | c.O_DIRECTORY | c.O_NOFOLLOW | c.O_NONBLOCK);
        try { await this.append(name, handle); } catch (error) { await handle.close(); throw error; }
      }
      await this.assert();
      return this;
    } catch (error) { await this.close(); throw error; }
  }

  async assert() {
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index];
      const location = index === 0 ? '/' : `/proc/self/fd/${this.nodes[index - 1].handle.fd}/${node.name}`;
      const stat = await fs.lstat(location);
      const pinned = await node.handle.stat();
      requireThat(stat.isDirectory() && !stat.isSymbolicLink() && sameNode(stat, node.stat) && sameNode(pinned, node.stat)
        && stat.uid === node.stat.uid && stat.mode === node.stat.mode, '证据目录身份在使用期间漂移', 10);
    }
  }

  async createChild(name) {
    requireThat(name.length > 0 && !/[/\\\u0000-\u001f\u007f]/u.test(name) && name !== '.' && name !== '..', '证据目录名无效', 10);
    await this.assert();
    await fs.mkdir(this.location(name), { mode: 0o700 });
    const handle = await fs.open(this.location(name), c.O_RDONLY | c.O_DIRECTORY | c.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      requireThat(stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700, '证据目标目录不受当前控制器独占', 10);
      await this.append(name, handle);
    } catch (error) { await handle.close(); throw error; }
    await this.assert();
    return this;
  }

  async read(name, limit) {
    requireThat(Object.hasOwn(EVIDENCE_LIMITS, name), '证据读取不在固定集合', 70);
    await this.assert();
    const handle = await fs.open(this.location(name), c.O_RDONLY | c.O_NOFOLLOW | c.O_NONBLOCK);
    try {
      const before = await handle.stat();
      requireThat(regular(before, limit), '证据必须为受控单链接普通文件且大小有界', 10);
      const bytes = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      const named = await fs.lstat(this.location(name));
      requireThat(regular(after, limit) && regular(named, limit) && sameNode(named, before) && sameNode(after, before)
        && length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
      '证据文件在读取期间漂移', 10);
      await this.assert();
      return bytes.subarray(0, length);
    } finally { await handle.close(); }
  }

  async write(name, bytes, limit) {
    requireThat(Object.hasOwn(EVIDENCE_LIMITS, name), '导出文件不在固定集合', 70);
    requireThat(bytes.length > 0 && bytes.length <= limit, '导出证据超过大小界限', 70);
    await this.assert();
    const handle = await fs.open(this.location(name), c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW | c.O_NONBLOCK, 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      requireThat(regular(await handle.stat(), limit), '导出证据类型或权限变化', 10);
    } finally { await handle.close(); }
    requireThat((await this.read(name, limit)).equals(bytes), '导出证据回读不匹配', 70);
    await this.nodes.at(-1).handle.sync();
  }

  async replaceEnvelope(expected, bytes, limit) {
    requireThat((await this.read('envelope.json', limit)).equals(expected), '拒绝覆盖发生变化的envelope', 10);
    await this.assert();
    await fs.unlink(this.location('envelope.json'));
    await this.write('envelope.json', bytes, limit);
  }

  async close() {
    for (const node of this.nodes.splice(0).reverse()) await node.handle.close();
  }
}
