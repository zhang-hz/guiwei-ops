import assert from 'node:assert/strict';
import { acceptCanary, acceptStartFailure } from '../../lib/ci/canary-verdict.mjs';

function sample(mode = 'timeout') {
  const inspect = { containerId: 'a'.repeat(64), status: 'exited', running: false, startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:03Z', exitCode: 137, oomKilled: false, error: '' };
  const result = { status: 'failed', inspect, counts: null, process: { exitCode: 137, cliExitCode: null, signal: 'SIGKILL',
    timedOut: true, overflow: false, interrupted: false, cleanupFailed: false }, cleanup: { confirmed: true, errors: [], containers: [{ terminal: { ...inspect }, absent: true }] },
  reasons: ['adapter-exit', 'adapter-signal', 'timeout', 'missing-or-invalid-report'] };
  if (mode === 'missing') {
    result.inspect.exitCode = result.process.exitCode = result.process.cliExitCode = 0;
    result.process.signal = null;
    result.process.timedOut = false;
    result.reasons = ['missing-or-invalid-report', 'report-invalid'];
    result.cleanup.containers[0].terminal = { ...result.inspect };
  }
  return result;
}

export const cases = [
  ['预期超时只接纳完整精确失败形状', () => {
    assert.equal(acceptCanary('timeout', sample()), true);
    for (const change of [
      value => { value.process.cleanupFailed = true; value.reasons.push('cleanup-failed'); },
      value => { value.inspect.oomKilled = true; value.reasons.push('memory-limit'); },
      value => { value.reasons.push('controller-error'); },
      value => { value.reasons.push('report-controller-error'); },
      value => { value.reasons.push('timeout'); },
      value => { value.cleanup.errors.push('engine-kill-failed'); },
      value => { value.process.overflow = true; },
      value => { value.inspect.startedAt = '0001-01-01T00:00:00Z'; },
      value => { value.inspect.status = 'running'; },
      value => { value.inspect.finishedAt = '0001-01-01T00:00:00Z'; },
      value => { value.process.exitCode = 0; },
      value => { value.process.cliExitCode = 1; },
      value => { value.inspect.error = 'Engine故障'; },
    ]) {
      const value = sample(); change(value);
      assert.equal(acceptCanary('timeout', value), false);
    }
    assert.equal(acceptCanary('unknown', sample()), false);
  }],
  ['各正常拒绝分支均需准确exit计数和完整原因', () => {
    for (const [mode, exitCode, counts, reasons] of [
      ['pass', 0, { total: 1, passed: 1, failed: 0, skipped: 0 }, []],
      ['assertion', 0, { total: 1, passed: 0, failed: 1, skipped: 0 }, ['test-failed']],
      ['skip', 0, { total: 1, passed: 0, failed: 0, skipped: 1 }, ['unapproved-skip']],
      ['false-exit', 7, { total: 1, passed: 1, failed: 0, skipped: 0 }, ['adapter-exit', 'docker-client-exit']],
      ['file-limit', 9, { total: 1, passed: 1, failed: 0, skipped: 0 }, ['adapter-exit', 'docker-client-exit']],
      ['exception', 1, null, ['adapter-exit', 'docker-client-exit', 'missing-or-invalid-report', 'report-invalid']],
    ]) {
      const result = sample('missing');
      result.inspect.exitCode = result.process.exitCode = result.process.cliExitCode = exitCode;
      result.cleanup.containers[0].terminal = { ...result.inspect };
      result.reportSha256 = counts ? 'b'.repeat(64) : null;
      result.counts = counts;
      result.reasons = [...reasons];
      result.status = mode === 'pass' ? 'passed' : 'failed';
      assert.equal(acceptCanary(mode, result), true, mode);
      result.reasons.push('controller-error');
      assert.equal(acceptCanary(mode, result), false, mode);
    }
  }],
  ['坏报告不能以created状态或额外控制错误替代实际运行', () => {
    const actual = sample('missing');
    assert.equal(acceptCanary('missing', actual), true);
    actual.inspect.status = 'created';
    actual.inspect.startedAt = actual.inspect.finishedAt = '0001-01-01T00:00:00Z';
    actual.process.cliExitCode = 1;
    actual.cleanup.containers[0].observed = { ...actual.inspect };
    actual.reasons = ['missing-or-invalid-report', 'docker-client-exit', 'engine-terminal-invalid'];
    assert.equal(acceptCanary('missing', actual), false);
    assert.equal(acceptStartFailure(actual), true);
    actual.reasons.push('controller-error');
    assert.equal(acceptStartFailure(actual), false);
  }],
];
