import fs from 'node:fs/promises';
import { constants as c } from 'node:fs';
import path from 'node:path';
import { digest, object, parseJson, requireThat } from '../core.mjs';
import { EvidenceDirectory, EVIDENCE_LIMITS } from './evidence-files.mjs';

const RECEIPT_LIMIT = 4096;
const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameNames = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const validInvocation = value => typeof value === 'string' && /^[0-9]{1,24}:[0-9]{1,12}:[A-Za-z_][A-Za-z0-9_-]{0,99}$/u.test(value);
const absolute = value => typeof value === 'string' && value.length <= 1024 && path.isAbsolute(value) && path.normalize(value) === value;

// 此端口仅在受信Runner的controller环境启用；adapter的env白名单不含这些键。
export function evidencePublicationRequest(env) {
  if (env.OPS_CI_EVIDENCE_PUBLICATION === undefined) return undefined;
  requireThat(env.OPS_CI_EVIDENCE_PUBLICATION === 'github-actions-v1' && env.GITHUB_ACTIONS === 'true'
    && validInvocation(env.OPS_CI_EVIDENCE_INVOCATION) && absolute(env.GITHUB_OUTPUT), '父证据发布通道配置无效', 70);
  requireThat(/^[A-Za-z0-9_.-]{1,200}$/u.test(path.basename(env.GITHUB_OUTPUT)), '父证据发布通道文件名无效', 70);
  return { invocation: env.OPS_CI_EVIDENCE_INVOCATION, outputFile: env.GITHUB_OUTPUT };
}

// 仅由独占新建、全部文件回读成功的导出路径调用；不从报告自称exported构造资格。
export async function createEvidenceReceipt(directory, destination, output, metadata, expected, invocation) {
  requireThat(validInvocation(invocation) && ['exported', 'incomplete'].includes(metadata.status), '父证据收据来源无效', 70);
  await directory.assert();
  const stat = await directory.nodes.at(-1).handle.stat({ bigint: true });
  return {
    version: 1, invocation, directory: destination, device: String(stat.dev), inode: String(stat.ino),
    runId: metadata.runId, exitCode: output.exitCode, exportStatus: metadata.status,
    files: [...expected].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: digest(bytes) })),
  };
}

function receiptBytes(receipt) {
  const bytes = Buffer.from(JSON.stringify(receipt), 'utf8');
  requireThat(bytes.length > 0 && bytes.length <= RECEIPT_LIMIT, '父证据收据超过界限', 70);
  return bytes;
}

// Runner的私有step-output是交接通道，原始stdout和artifact JSON都不是资格来源。
export async function publishEvidenceReceipt(request, receipt) {
  requireThat(receipt && receipt.invocation === request.invocation, '本次ops未产生安全发布收据', 70);
  const bytes = Buffer.from(`evidence_receipt=${receiptBytes(receipt).toString('base64')}\n`, 'utf8');
  const parent = await new EvidenceDirectory().open(path.dirname(request.outputFile));
  let handle;
  try {
    const name = path.basename(request.outputFile);
    handle = await fs.open(parent.location(name), c.O_RDWR | c.O_APPEND | c.O_NOFOLLOW | c.O_NONBLOCK);
    const before = await handle.stat();
    const named = await fs.lstat(parent.location(name));
    requireThat(before.isFile() && before.nlink === 1 && before.uid === process.getuid() && (before.mode & 0o022) === 0
      && before.size === 0 && named.isFile() && !named.isSymbolicLink() && sameNode(before, named), 'Runner发布通道不是本步骤的空普通单链接文件', 70);
    await handle.writeFile(bytes);
    await handle.sync();
    const observed = Buffer.alloc(bytes.length + 1);
    let length = 0;
    while (length < observed.length) {
      const read = await handle.read(observed, length, observed.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    const final = await fs.lstat(parent.location(name));
    requireThat(after.isFile() && after.nlink === 1 && after.size === bytes.length && after.uid === before.uid && after.mode === before.mode
      && sameNode(after, before) && final.isFile() && !final.isSymbolicLink() && sameNode(final, before)
      && final.nlink === 1 && final.size === bytes.length && final.uid === before.uid && final.mode === before.mode
      && length === bytes.length && observed.subarray(0, length).equals(bytes), 'Runner发布通道在交接期间漂移', 70);
    await parent.assert();
  } finally {
    try { await handle?.close(); } finally { await parent.close(); }
  }
}

function decodeReceipt(encoded, invocation, destination, actualExitCode) {
  requireThat(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 4 * Math.ceil(RECEIPT_LIMIT / 3)
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded), '缺少本次ops的有界发布收据', 70);
  const bytes = Buffer.from(encoded, 'base64');
  requireThat(bytes.toString('base64') === encoded, '发布收据编码不规范', 70);
  const receipt = parseJson(bytes, RECEIPT_LIMIT);
  object(receipt, ['version', 'invocation', 'directory', 'device', 'inode', 'runId', 'exitCode', 'exportStatus', 'files']);
  requireThat(receipt.version === 1 && validInvocation(invocation) && receipt.invocation === invocation && absolute(destination)
    && receipt.directory === destination && typeof actualExitCode === 'string' && /^(?:0|[1-9][0-9]{0,2})$/u.test(actualExitCode)
    && Number(actualExitCode) <= 255 && receipt.exitCode === Number(actualExitCode), '发布收据与本次调用或实际退出不匹配', 70);
  requireThat(typeof receipt.device === 'string' && /^[0-9]{1,30}$/u.test(receipt.device)
    && typeof receipt.inode === 'string' && /^[0-9]{1,30}$/u.test(receipt.inode)
    && (receipt.runId === null || typeof receipt.runId === 'string' && /^run_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(receipt.runId))
    && ['exported', 'incomplete'].includes(receipt.exportStatus), '发布收据目录或run身份无效', 70);
  requireThat(Array.isArray(receipt.files) && receipt.files.length >= 1 && receipt.files.length <= 4, '发布收据文件集合无效', 70);
  const names = new Set();
  for (const file of receipt.files) {
    object(file, ['name', 'bytes', 'sha256']);
    requireThat(typeof file.name === 'string' && Object.hasOwn(EVIDENCE_LIMITS, file.name) && !names.has(file.name)
      && Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= EVIDENCE_LIMITS[file.name]
      && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256), '发布收据文件越界或重复', 70);
    names.add(file.name);
  }
  requireThat(names.has('envelope.json') && (receipt.runId !== null || names.size === 1 && receipt.exitCode !== 0), '无run不能发布报告或成功', 70);
  requireThat(receipt.exitCode !== 0 || receipt.runId !== null && receipt.exportStatus === 'exported'
    && sameNames(names, Object.keys(EVIDENCE_LIMITS)), '成功缺少完整父证据', 70);
  return receipt;
}

// 这是封闭artifact IO验证，不调度suite、不执行适配器，也不决定质量是否通过。
export async function verifyEvidencePublication({ encoded, invocation, destination, actualExitCode }) {
  const receipt = decodeReceipt(encoded, invocation, destination, actualExitCode);
  const directory = await new EvidenceDirectory().open(destination);
  try {
    const checkIdentity = async () => {
      await directory.assert();
      const stat = await directory.nodes.at(-1).handle.stat({ bigint: true });
      requireThat(String(stat.dev) === receipt.device && String(stat.ino) === receipt.inode
        && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o777n) === 0o700n, '导出目录不是本次创建的受控inode', 70);
      requireThat(sameNames(await fs.readdir(directory.location()), receipt.files.map(file => file.name)), '导出目录出现缺件或额外文件', 70);
    };
    await checkIdentity();
    let parent;
    for (const file of receipt.files) {
      const bytes = await directory.read(file.name, EVIDENCE_LIMITS[file.name]);
      requireThat(bytes.length === file.bytes && digest(bytes) === file.sha256, '导出证据与controller收据不符', 70);
      if (file.name === 'envelope.json') parent = parseJson(bytes, EVIDENCE_LIMITS[file.name]);
    }
    requireThat(parent?.exitCode === receipt.exitCode && parent.evidenceExport?.runId === receipt.runId
      && parent.evidenceExport.status === receipt.exportStatus && Array.isArray(parent.evidenceExport.files)
      && sameNames(parent.evidenceExport.files, receipt.files.map(file => file.name)), '父级envelope与收据不匹配', 70);
    await checkIdentity();
  } finally { await directory.close(); }
}
