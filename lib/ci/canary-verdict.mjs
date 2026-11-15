const same = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
  && new Set(actual).size === actual.length && expected.every(value => actual.includes(value));
const countsEqual = (value, passed, failed = 0, skipped = 0) => value?.total === passed + failed + skipped
  && value.passed === passed && value.failed === failed && value.skipped === skipped;

export function terminalRun(value) {
  return value && /^[a-f0-9]{64}$/u.test(value.containerId) && value.status === 'exited' && value.running === false
    && Date.parse(value.startedAt) > 0 && Date.parse(value.finishedAt) >= Date.parse(value.startedAt)
    && Number.isInteger(value.exitCode) && value.oomKilled === false && value.error === '';
}

// 每种负向试验只允许一组完整失败形状；未知、附加失败均拒绝。
export function acceptCanary(mode, result) {
  const process = result?.process;
  const state = result?.inspect;
  if (!process || !terminalRun(state) || process.exitCode !== state.exitCode || process.cleanupFailed !== false) return false;
  if (result.counts !== null && !/^[a-f0-9]{64}$/u.test(result.reportSha256)) return false;
  const expectedCleanupFailure = mode === 'cleanup-failure';
  if (result.cleanup?.confirmed !== !expectedCleanupFailure) return false;
  if (!same(result.cleanup.errors, [])) return false;
  const fields = ['containerId', 'status', 'running', 'startedAt', 'finishedAt', 'exitCode', 'oomKilled', 'error'];
  if (!result.cleanup.containers?.some(item => terminalRun(item.terminal) && fields.every(key => item.terminal[key] === state[key]))) return false;
  const timedOut = ['timeout', 'tree'].includes(mode);
  const overflow = mode === 'output';
  const interrupted = ['SIGTERM', 'SIGINT'].includes(mode);
  if (process.timedOut !== timedOut || process.overflow !== overflow || process.interrupted !== interrupted) return false;
  if (timedOut || overflow || interrupted) {
    if (result.status !== 'failed' || state.exitCode !== 137 || process.signal !== 'SIGKILL' || process.cliExitCode !== null || result.counts !== null) return false;
    return same(result.reasons, ['adapter-exit', 'adapter-signal', timedOut ? 'timeout' : overflow ? 'output-limit' : 'interrupted', 'missing-or-invalid-report']);
  }
  if (process.signal !== null || process.cliExitCode !== state.exitCode) return false;
  if (mode === 'false-exit') return result.status === 'failed' && state.exitCode === 7 && countsEqual(result.counts, 1)
    && same(result.reasons, ['adapter-exit', 'docker-client-exit']);
  if (mode === 'file-limit') return result.status === 'failed' && state.exitCode === 9 && countsEqual(result.counts, 1)
    && same(result.reasons, ['adapter-exit', 'docker-client-exit']);
  if (mode === 'exception') return result.status === 'failed' && state.exitCode === 1 && result.counts === null
    && same(result.reasons, ['adapter-exit', 'docker-client-exit', 'missing-or-invalid-report', 'report-invalid']);
  if (state.exitCode !== 0) return false;
  if (mode === 'assertion') return result.status === 'failed' && countsEqual(result.counts, 0, 1) && same(result.reasons, ['test-failed']);
  if (mode === 'skip') return result.status === 'failed' && countsEqual(result.counts, 0, 0, 1) && same(result.reasons, ['unapproved-skip']);
  if (expectedCleanupFailure) return result.status === 'failed' && countsEqual(result.counts, 1)
    && same(result.reasons, ['cleanup-failed']) && result.cleanup.containers?.some(item => item.absent === false && terminalRun(item.terminal));
  if (['pass', 'escape', 'environment', 'network', 'output-quota'].includes(mode)) return result.status === 'passed'
    && countsEqual(result.counts, 1) && same(result.reasons, []);
  if (['empty', 'missing', 'invalid', 'forged', 'duplicate', 'extra-field', 'symlink', 'hardlink'].includes(mode)) return result.status === 'failed'
    && result.counts === null && same(result.reasons, ['missing-or-invalid-report', 'report-invalid']);
  return false;
}

export function acceptStartFailure(result) {
  const state = result?.inspect;
  const process = result?.process;
  return state?.status === 'created' && /^[a-f0-9]{64}$/u.test(state.containerId) && state.running === false && !(Date.parse(state.startedAt) > 0)
    && state.exitCode === 0 && state.oomKilled === false && state.error === '' && process?.cliExitCode === 1 && process.signal === null
    && process.timedOut === false && process.overflow === false && process.interrupted === false && process.cleanupFailed === false
    && result.counts === null && result.status === 'failed' && result.cleanup.confirmed === true && same(result.cleanup.errors, [])
    && result.cleanup.containers?.some(item => item.observed?.containerId === state.containerId && item.observed.status === 'created' && item.absent === true)
    && same(result.reasons, ['missing-or-invalid-report', 'docker-client-exit', 'engine-terminal-invalid']) && !acceptCanary('missing', result);
}
