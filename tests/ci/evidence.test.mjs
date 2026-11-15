import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, envelope } from '../../lib/core.mjs';
import { atomicJson, atomicBytes } from '../../lib/filesystem.mjs';
import { exportEvidence, exportEvidenceBundle } from '../../lib/ci/evidence.mjs';
import { evidencePublicationRequest, publishEvidenceReceipt, verifyEvidencePublication } from '../../lib/ci/evidence-publication.mjs';
import { parseArguments } from '../../lib/ci/arguments.mjs';
import { toJUnit } from '../../lib/ci/report.mjs';

const id = 'run_00000000-0000-4000-8000-000000000000';
const startedAt = '2026-01-01T00:00:00Z';
async function fixture(execute, exitCode = 0) {
  const root = await fs.mkdtemp('/tmp/control-evidence-');
  const directory = path.join(root, id);
  await fs.mkdir(directory, { mode: 0o700 });
  const result = { ...envelope('ci', id, startedAt, exitCode, '父级实际结论'), ci: { suites: [{ id: 'actual-suite', tier: 'unit',
    status: exitCode ? 'failed' : 'passed', reasons: exitCode ? ['test-failed'] : [] }] } };
  const junit = Buffer.from(toJUnit({ suites: result.ci.suites }));
  result.evidence.push({ path: `.ops-ci/runs/${id}/junit.xml`, sha256: digest(junit) });
  await atomicJson(path.join(directory, 'result.json'), result);
  const state = { schemaVersion: 1, runId: id, startedAt, finishedAt: result.finishedAt, exitCode, phase: exitCode ? 'failed' : 'completed' };
  await atomicJson(path.join(directory, 'state.json'), state);
  await atomicBytes(path.join(directory, 'junit.xml'), junit);
  try { await execute({ root, run: { id, directory, result, state }, result }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
const readEnvelope = directory => fs.readFile(path.join(directory, 'envelope.json'), 'utf8').then(JSON.parse);
const invocation = '123456:2:control-bootstrap';
const encodedReceipt = receipt => Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64');
const verify = (destination, receipt, actualExitCode = String(receipt?.exitCode)) => verifyEvidencePublication({
  encoded: receipt ? encodedReceipt(receipt) : '', invocation, destination, actualExitCode,
});
const publicationRequest = outputFile => evidencePublicationRequest({ OPS_CI_EVIDENCE_PUBLICATION: 'github-actions-v1',
  OPS_CI_EVIDENCE_INVOCATION: invocation, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: outputFile });

export const cases = [
  ['唯一parser接受绝对evidence-dir并拒重复与相对目录', () => {
    assert.equal(parseArguments(['ci', '--json', '--evidence-dir', '/tmp/ops-ci-evidence']).evidenceDir, '/tmp/ops-ci-evidence');
    for (const args of [['ci', '--evidence-dir', 'relative'], ['ci', '--evidence-dir'], ['ci', '--evidence-dir', '/tmp/a', '--evidence-dir', '/tmp/b'],
      ['ci', '--evidence-dir', '/tmp/../escape']]) assert.throws(() => parseArguments(args));
    assert.throws(() => parseArguments(['ci', '--evidence-dir', '/tmp/ops-ci-evidence', '--profile', 'invalid']), error => error.evidenceDir === '/tmp/ops-ci-evidence');
  }],
  ['成功和执行失败均仅导出已知父级四文件且保持原exit', async () => {
    for (const exitCode of [0, 50]) await fixture(async ({ root, run, result }) => {
      // 历史run和原始stdout不参与发现或上传集合。
      await fs.mkdir(path.join(root, 'other-run'));
      await fs.writeFile(path.join(root, 'other-run/result.json'), '不应导出');
      await fs.symlink(path.join(root, 'other-run/result.json'), path.join(root, 'stdout.json'));
      const destination = path.join(root, 'export');
      const output = await exportEvidence(destination, result, run);
      assert.equal(output.exitCode, exitCode);
      assert.equal(output.evidenceExport.status, 'exported');
      assert.deepEqual((await fs.readdir(destination)).sort(), ['envelope.json', 'junit.xml', 'result.json', 'state.json']);
      assert.deepEqual(await readEnvelope(destination), output);
      for (const name of output.evidenceExport.files) {
        const stat = await fs.lstat(path.join(destination, name));
        assert.ok(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600);
      }
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination, 'result.json'), 'utf8')), result);
    }, exitCode);
  }],
  ['预检无run仅保留失败envelope而成功无run拒绝', () => fixture(async ({ root }) => {
    for (const exitCode of [10, 0]) {
      const destination = path.join(root, `preflight-${exitCode}`);
      const output = await exportEvidence(destination, envelope('ci', id, startedAt, exitCode, '预检结果'));
      assert.notEqual(output.exitCode, 0);
      assert.equal(output.evidenceExport.originalExitCode, exitCode);
      assert.deepEqual(await fs.readdir(destination), ['envelope.json']);
      assert.deepEqual(await readEnvelope(destination), output);
    }
  })],
  ['任一父级报告缺失不补造成功并保留其他安全证据', async () => {
    for (const name of ['result.json', 'state.json', 'junit.xml']) await fixture(async ({ root, run, result }) => {
      await fs.unlink(path.join(run.directory, name));
      const destination = path.join(root, 'export');
      const output = await exportEvidence(destination, result, run);
      assert.equal(output.exitCode, 70);
      assert.equal(output.evidenceExport.status, 'incomplete');
      assert.ok(output.evidenceExport.gaps.some(gap => gap.name === name));
      assert.equal((await fs.readdir(destination)).includes(name), false);
      assert.deepEqual(await readEnvelope(destination), output);
    });
  }],
  ['编排早期失败缺JUnit明确记录不适用且state额外字段也拒绝', () => fixture(async ({ root, run }) => {
    const result = envelope('ci', id, startedAt, 50, 'suite结果形成前失败');
    const state = { schemaVersion: 1, runId: id, startedAt, finishedAt: result.finishedAt, exitCode: 50, phase: 'failed' };
    run.result = result; run.state = state;
    await atomicJson(path.join(run.directory, 'result.json'), result);
    await atomicJson(path.join(run.directory, 'state.json'), { ...state, extra: '不允许携带的额外内容' });
    await fs.unlink(path.join(run.directory, 'junit.xml'));
    const destination = path.join(root, 'export');
    const output = await exportEvidence(destination, result, run);
    assert.equal(output.exitCode, 50);
    assert.deepEqual((await fs.readdir(destination)).sort(), ['envelope.json', 'result.json']);
    assert.ok(output.evidenceExport.gaps.some(gap => gap.name === 'junit.xml' && gap.reason === 'not-produced-without-suite-results'));
    assert.ok(output.evidenceExport.gaps.some(gap => gap.name === 'state.json'));
  })],
  ['源文件符号硬链接与错误run身份均不导出且失败仍非零', async () => {
    for (const mode of ['symlink', 'hardlink', 'wrong-run', 'oversized', 'directory']) await fixture(async ({ root, run, result }) => {
      const target = path.join(run.directory, 'result.json');
      if (mode === 'hardlink') await fs.link(target, path.join(root, 'linked-result'));
      else if (mode === 'wrong-run') await atomicJson(target, { ...result, runId: 'run_11111111-1111-4111-8111-111111111111' });
      else if (mode === 'oversized') await fs.writeFile(target, Buffer.alloc(8 * 1048576 + 1), { mode: 0o600 });
      else if (mode === 'symlink') {
        await fs.unlink(target);
        await fs.symlink(path.join(run.directory, 'state.json'), target);
      } else {
        // 不依赖额外宿主工具：目录同样验证非普通文件在open前后均不可接受。
        await fs.unlink(target); await fs.mkdir(target);
      }
      const destination = path.join(root, 'export');
      const output = await exportEvidence(destination, result, run);
      assert.equal(output.exitCode, 50);
      assert.equal((await fs.readdir(destination)).includes('result.json'), false);
      assert.ok(output.evidenceExport.gaps.some(gap => gap.name === 'result.json'));
    }, 50);
  }],
  ['逐级源父目录链接拒绝而安全目标仍保留失败envelope', () => fixture(async ({ root, run, result }) => {
    const parent = path.join(root, 'parent');
    await fs.symlink(root, parent);
    const destination = path.join(root, 'export');
    const output = await exportEvidence(destination, result, { ...run, directory: path.join(parent, id) });
    assert.equal(output.exitCode, 70);
    assert.deepEqual(await fs.readdir(destination), ['envelope.json']);
    assert.equal(output.evidenceExport.gaps.some(gap => gap.name === 'run'), true);
  })],
  ['导出目标必须独占新建且全部祖先不可为链接', () => fixture(async ({ root, run, result }) => {
    const existing = path.join(root, 'existing');
    await fs.mkdir(existing);
    await fs.writeFile(path.join(existing, 'sentinel'), '保留原文件');
    const symbolic = path.join(root, 'symbolic');
    await fs.symlink(existing, symbolic);
    const parent = path.join(root, 'parent');
    await fs.symlink(root, parent);
    for (const destination of [existing, symbolic, path.join(parent, 'new-export')]) {
      const output = await exportEvidence(destination, result, run);
      assert.notEqual(output.exitCode, 0);
      assert.equal(output.evidenceExport.status, 'rejected');
    }
    assert.deepEqual(await fs.readdir(existing), ['sentinel']);
  })],
  ['失败envelope超限时只导出有界缺口说明', () => fixture(async ({ root }) => {
    const destination = path.join(root, 'export');
    const result = envelope('ci', id, startedAt, 10, 'x'.repeat(8 * 1048576));
    const output = await exportEvidence(destination, result);
    assert.equal(output.exitCode, 10);
    assert.ok(output.evidenceExport.gaps.some(gap => gap.reason === 'parent-envelope-oversized-details-omitted'));
    assert.ok((await fs.stat(path.join(destination, 'envelope.json'))).size < 65536);
  })],
  ['成功和原失败通过私有收据发布且artifact IO验证不改exit', async () => {
    for (const exitCode of [0, 50]) await fixture(async ({ root, result, run }) => {
      const destination = path.join(root, 'export');
      const bundle = await exportEvidenceBundle(destination, result, run, invocation);
      const channel = path.join(root, 'set_output_test');
      await fs.writeFile(channel, '', { mode: 0o600 });
      await publishEvidenceReceipt(publicationRequest(channel), bundle.receipt);
      const output = await fs.readFile(channel, 'utf8');
      assert.equal(output, `evidence_receipt=${encodedReceipt(bundle.receipt)}\n`);
      await verifyEvidencePublication({ encoded: output.trim().slice('evidence_receipt='.length), invocation, destination, actualExitCode: String(exitCode) });
      assert.equal(bundle.output.exitCode, exitCode);
      assert.equal(bundle.receipt.exitCode, exitCode);
      assert.equal(bundle.receipt.files.length, 4);
    }, exitCode);
  }],
  ['安全预检失败与安全缺件子集可发布但成功缺件始终非零', () => fixture(async ({ root, run, result }) => {
    const preflight = await exportEvidenceBundle(path.join(root, 'preflight'), envelope('ci', id, startedAt, 10, '预检失败'), undefined, invocation);
    assert.deepEqual(preflight.receipt.files.map(file => file.name), ['envelope.json']);
    await verify(path.join(root, 'preflight'), preflight.receipt, '10');
    await fs.unlink(path.join(run.directory, 'state.json'));
    const partial = await exportEvidenceBundle(path.join(root, 'partial'), result, run, invocation);
    assert.equal(partial.output.exitCode, 70);
    assert.equal(partial.receipt.exportStatus, 'incomplete');
    await verify(path.join(root, 'partial'), partial.receipt, '70');
    await assert.rejects(verify(path.join(root, 'partial'), { ...partial.receipt, exitCode: 0 }));
  })],
  ['CLI未运行与既存或链接目标无收据且不因JSON自称exported获资格', () => fixture(async ({ root, result, run }) => {
    const destination = path.join(root, 'existing');
    await fs.mkdir(destination, { mode: 0o700 });
    await atomicJson(path.join(destination, 'envelope.json'), { ...result, evidenceExport: { status: 'exported' } });
    const symbolic = path.join(root, 'linked');
    await fs.symlink(destination, symbolic);
    for (const target of [destination, symbolic]) {
      const bundle = await exportEvidenceBundle(target, result, run, invocation);
      assert.equal(bundle.receipt, null);
      assert.equal(bundle.output.evidenceExport.status, 'rejected');
      await assert.rejects(verify(target, bundle.receipt));
      const channel = path.join(root, target === destination ? 'set_output_existing' : 'set_output_linked');
      await fs.writeFile(channel, '', { mode: 0o600 });
      await assert.rejects(publishEvidenceReceipt(publicationRequest(channel), bundle.receipt));
      assert.equal(await fs.readFile(channel, 'utf8'), '');
    }
    await assert.rejects(verify(path.join(root, 'never-created'), null));
  })],
  ['本次收据拒绝文件变化缺失额外名软硬链接与非普通文件', async () => {
    for (const mode of ['changed', 'missing', 'extra', 'symlink', 'hardlink', 'directory', 'mode']) await fixture(async ({ root, result, run }) => {
      const destination = path.join(root, 'export');
      const { receipt } = await exportEvidenceBundle(destination, result, run, invocation);
      const file = path.join(destination, 'state.json');
      if (mode === 'changed') await atomicJson(file, { ...run.state, exitCode: 70 });
      else if (mode === 'missing') await fs.unlink(file);
      else if (mode === 'extra') await fs.writeFile(path.join(destination, 'unreviewed.json'), '额外文件', { mode: 0o600 });
      else if (mode === 'hardlink') await fs.link(file, path.join(root, 'second-link'));
      else if (mode === 'mode') await fs.chmod(file, 0o644);
      else {
        await fs.unlink(file);
        if (mode === 'symlink') await fs.symlink(path.join(run.directory, 'state.json'), file);
        else await fs.mkdir(file);
      }
      await assert.rejects(verify(destination, receipt));
    });
  }],
  ['收据绑定准确目录inode且父目录不能换为链接', async () => {
    for (const mode of ['inode', 'parent-link']) await fixture(async ({ root, result, run }) => {
      const parent = path.join(root, 'parent');
      await fs.mkdir(parent, { mode: 0o700 });
      const destination = path.join(parent, 'export');
      const { receipt } = await exportEvidenceBundle(destination, result, run, invocation);
      if (mode === 'parent-link') {
        await fs.rename(parent, path.join(root, 'original-parent'));
        await fs.symlink(path.join(root, 'original-parent'), parent);
      } else {
        const previous = path.join(parent, 'original-export');
        await fs.rename(destination, previous);
        await fs.mkdir(destination, { mode: 0o700 });
        for (const file of receipt.files) await atomicBytes(path.join(destination, file.name), await fs.readFile(path.join(previous, file.name)));
      }
      await assert.rejects(verify(destination, receipt));
    });
  }],
  ['收据拒绝旧调用错误目标exit缺件重复名与超限编码', () => fixture(async ({ root, result, run }) => {
    const destination = path.join(root, 'export');
    const { receipt } = await exportEvidenceBundle(destination, result, run, invocation);
    for (const invalid of [
      { ...receipt, invocation: '123456:1:control-bootstrap' },
      { ...receipt, directory: path.join(root, 'other') },
      { ...receipt, runId: null },
      { ...receipt, files: receipt.files.filter(file => file.name !== 'state.json') },
      { ...receipt, files: [receipt.files[0], receipt.files[0]] },
      { ...receipt, files: receipt.files.map(file => ({ ...file, bytes: 9 * 1048576 })) },
    ]) await assert.rejects(verify(destination, invalid));
    await assert.rejects(verify(destination, receipt, '50'));
    for (const encoded of ['', 'invalid!', 'eA==\n', 'A'.repeat(6000)]) await assert.rejects(verifyEvidencePublication({ encoded, invocation, destination, actualExitCode: '0' }));
  })],
  ['Runner私有发布通道拒绝已有内容链接硬链接父链接和可写权限', async () => {
    for (const mode of ['nonempty', 'symlink', 'hardlink', 'parent-link', 'mode', 'directory']) await fixture(async ({ root, result, run }) => {
      const { receipt } = await exportEvidenceBundle(path.join(root, 'export'), result, run, invocation);
      const parent = path.join(root, 'channel-parent');
      await fs.mkdir(parent, { mode: 0o700 });
      let channel = path.join(parent, 'set_output_test');
      await fs.writeFile(channel, mode === 'nonempty' ? '保留原内容' : '', { mode: 0o600 });
      if (mode === 'hardlink') await fs.link(channel, path.join(root, 'channel-link'));
      else if (mode === 'mode') await fs.chmod(channel, 0o666);
      else if (mode === 'parent-link') {
        const symbolic = path.join(root, 'linked-parent');
        await fs.symlink(parent, symbolic); channel = path.join(symbolic, 'set_output_test');
      } else if (mode === 'symlink' || mode === 'directory') {
        await fs.unlink(channel);
        if (mode === 'symlink') { await fs.writeFile(path.join(root, 'actual-channel'), '', { mode: 0o600 }); await fs.symlink(path.join(root, 'actual-channel'), channel); }
        else await fs.mkdir(channel);
      }
      await assert.rejects(publishEvidenceReceipt(publicationRequest(channel), receipt));
    });
    assert.equal(evidencePublicationRequest({ GITHUB_ACTIONS: 'true' }), undefined);
    for (const env of [{ OPS_CI_EVIDENCE_PUBLICATION: 'invalid' }, { OPS_CI_EVIDENCE_PUBLICATION: 'github-actions-v1', GITHUB_ACTIONS: 'true',
      GITHUB_OUTPUT: '/tmp/set_output_test', OPS_CI_EVIDENCE_INVOCATION: '旧调用\n注入' }]) assert.throws(() => evidencePublicationRequest(env));
  }],
];
