import path from 'node:path';
import fs from 'node:fs/promises';
import { digest, envelope, parseJson, requireThat } from '../core.mjs';
import { toJUnit } from './report.mjs';
import { EvidenceDirectory, EVIDENCE_LIMITS as LIMITS } from './evidence-files.mjs';
import { createEvidenceReceipt } from './evidence-publication.mjs';

const encode = value => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
const failed = (result, metadata) => ({ ...result, status: 'failed', exitCode: result.exitCode || 70, evidenceExport: metadata });

export function boundCommandResult(result) {
  if (encode(result).length <= LIMITS['envelope.json']) return result;
  return envelope('ci', result.runId, result.startedAt, result.exitCode || 70, '父级输出超过8MiB界限，详细结果未输出');
}

function exportEnvelope(result, metadata) {
  let output = metadata.gaps.length || metadata.status === 'rejected' ? failed(result, metadata) : { ...result, evidenceExport: metadata };
  let bytes = encode(output);
  if (bytes.length > LIMITS['envelope.json']) {
    if (metadata.status !== 'rejected') metadata.status = 'incomplete';
    if (!metadata.gaps.some(gap => gap.reason === 'parent-envelope-oversized-details-omitted')) metadata.gaps.push({ name: 'envelope.json', reason: 'parent-envelope-oversized-details-omitted' });
    output = { ...envelope('ci', result.runId, result.startedAt, result.exitCode || 70, '父级输出超过导出界限，详细结果未导出'), evidenceExport: metadata };
    bytes = encode(output);
  }
  return { output, bytes };
}

// run来自reserveRun回调的父级内存身份；不扫描历史目录，也不读取shell捕获的stdout。
export async function exportEvidenceBundle(destination, result, run, invocation) {
  const originalExitCode = result.exitCode;
  const metadata = { status: 'rejected', runId: run?.id ?? null, originalExitCode, files: [], gaps: [] };
  const target = new EvidenceDirectory();
  let source;
  let created = false;
  let envelopeBytes;
  try {
    requireThat(path.isAbsolute(destination) && path.normalize(destination) === destination, '导出目标必须是规范绝对目录', 10);
    await target.open(path.dirname(destination));
    await target.createChild(path.basename(destination));
    created = true;
    const accepted = new Map();
    if (!run) {
      if (originalExitCode === 0) metadata.gaps.push({ name: 'run', reason: 'successful-command-without-run' });
    } else {
      requireThat(run.id === result.runId && path.basename(run.directory) === run.id, '导出run身份不匹配', 70);
      try { source = await new EvidenceDirectory().open(run.directory); }
      catch { metadata.gaps.push({ name: 'run', reason: 'unsafe-or-missing-parent-directory' }); }
      for (const name of ['result.json', 'state.json', 'junit.xml']) {
        if (!source) { metadata.gaps.push({ name, reason: 'parent-directory-unavailable' }); continue; }
        if (name === 'junit.xml' && !run.result?.ci) { metadata.gaps.push({ name, reason: 'not-produced-without-suite-results' }); continue; }
        try {
          const bytes = await source.read(name, LIMITS[name]);
          if (name === 'result.json') {
            const value = parseJson(bytes, LIMITS[name]);
            requireThat(run.result && value.runId === run.id && bytes.equals(encode(run.result)), '父级result身份或内容不匹配', 70);
          } else if (name === 'state.json') {
            const state = parseJson(bytes, LIMITS[name]);
            requireThat(run.state && bytes.equals(encode(run.state)) && state.schemaVersion === 1 && state.runId === run.id && state.startedAt === run.result?.startedAt
              && state.finishedAt === run.result.finishedAt && state.exitCode === run.result.exitCode
              && state.phase === (state.exitCode === 0 ? 'completed' : 'failed'), '父级state未终结或身份不匹配', 70);
          } else {
            requireThat(run.result?.ci && bytes.equals(Buffer.from(toJUnit({ suites: run.result.ci.suites }))), '父级JUnit与实际suite不匹配', 70);
            requireThat(run.result.evidence.some(item => item.path === `.ops-ci/runs/${run.id}/junit.xml` && item.sha256 === digest(bytes)), '父级JUnit摘要不匹配', 70);
          }
          accepted.set(name, bytes);
        } catch { metadata.gaps.push({ name, reason: 'missing-unsafe-oversized-or-mismatched' }); }
      }
    }
    for (const [name, bytes] of accepted) {
      await target.write(name, bytes, LIMITS[name]);
      metadata.files.push(name);
    }
    for (const [name, bytes] of accepted) requireThat((await target.read(name, LIMITS[name])).equals(bytes), '导出父级证据最终回读不一致', 70);
    metadata.status = metadata.gaps.length ? 'incomplete' : 'exported';
    metadata.files.push('envelope.json');
    // envelope由已知父级结果编码，经同一普通文件/链接/大小边界回读。
    const formatted = exportEnvelope(result, metadata);
    const output = formatted.output;
    envelopeBytes = formatted.bytes;
    await target.write('envelope.json', envelopeBytes, LIMITS['envelope.json']);
    await target.assert();
    const names = await fs.readdir(target.location());
    requireThat(names.length === metadata.files.length && names.every(name => metadata.files.includes(name)), '导出目录出现非本次固定集合', 70);
    const expected = new Map(accepted);
    expected.set('envelope.json', envelopeBytes);
    for (const [name, bytes] of expected) requireThat((await target.read(name, LIMITS[name])).equals(bytes), '发布前父证据最终回读不一致', 70);
    const receipt = invocation ? await createEvidenceReceipt(target, destination, output, metadata, expected, invocation) : null;
    return { output, receipt };
  } catch {
    metadata.status = 'rejected';
    metadata.gaps.push({ name: 'export', reason: 'unsafe-existing-target-or-export-failure' });
    // 只有本进程独占新建且仍安全的目录可保留失败envelope；绝不覆盖已有路径。
    if (created && !metadata.files.includes('envelope.json')) {
      try {
        metadata.files.push('envelope.json');
        await target.write('envelope.json', exportEnvelope(result, metadata).bytes, LIMITS['envelope.json']);
      } catch { metadata.files = metadata.files.filter(name => name !== 'envelope.json'); }
    } else if (created && envelopeBytes) {
      try { await target.replaceEnvelope(envelopeBytes, exportEnvelope(result, metadata).bytes, LIMITS['envelope.json']); }
      catch { metadata.gaps.push({ name: 'envelope.json', reason: 'failure-envelope-could-not-be-preserved' }); }
    }
    return { output: exportEnvelope(result, metadata).output, receipt: null };
  } finally {
    await source?.close();
    await target.close();
  }
}

export async function exportEvidence(destination, result, run) {
  return (await exportEvidenceBundle(destination, result, run)).output;
}
