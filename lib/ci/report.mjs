import { identifier, integer, list, object, requireThat, textValue, unique } from '../core.mjs';

export function validateAdapterReport(value, expected) {
  object(value, ['schemaVersion', 'runId', 'suiteId', 'nonce', 'tests']);
  requireThat(/^run_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.runId) && /^[a-f0-9]{64}$/u.test(value.nonce), '报告调用身份格式无效', 50);
  requireThat(value.schemaVersion === 1 && value.runId === expected.runId && value.suiteId === expected.suiteId && value.nonce === expected.nonce, '报告调用身份不匹配', 50);
  identifier(value.suiteId);
  list(value.tests, 100000);
  requireThat(value.tests.length > 0, '报告为空跑', 50);
  unique(value.tests.map(test => {
    object(test, ['id', 'status']);
    textValue(test.id, 256);
    requireThat(['passed', 'failed', 'skipped'].includes(test.status), '用例状态无效', 50);
    return test.id;
  }), '用例标识重复');
  const counts = { total: value.tests.length, passed: 0, failed: 0, skipped: 0 };
  value.tests.forEach(test => counts[test.status]++);
  return counts;
}

export function judgeSuite(process, counts, cleanup) {
  const reasons = [];
  if (process.exitCode !== 0) reasons.push('adapter-exit');
  if (process.signal) reasons.push('adapter-signal');
  if (process.timedOut) reasons.push('timeout');
  if (process.overflow) reasons.push('output-limit');
  if (process.interrupted) reasons.push('interrupted');
  if (process.cleanupFailed || !cleanup.confirmed) reasons.push('cleanup-failed');
  if (!counts) reasons.push('missing-or-invalid-report');
  else {
    if (counts.total === 0) reasons.push('empty');
    if (counts.failed > 0) reasons.push('test-failed');
    if (counts.skipped > 0) reasons.push('unapproved-skip');
  }
  return { status: reasons.length ? 'failed' : 'passed', reasons };
}

export function aggregateSuites(results, selected) {
  requireThat(Array.isArray(selected) && selected.length > 0, '父级未提供准确suite集合', 50);
  const expected = new Map(selected.map(suite => [suite.id, suite.tier]));
  requireThat(expected.size === selected.length && results.length === expected.size, '父级聚合缺失suite', 50);
  unique(results.map(result => result.id), '父级聚合suite重复');
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const result of results) {
    requireThat(expected.has(result.id) && expected.get(result.id) === result.tier, '父级聚合suite身份不匹配', 50);
    requireThat(['passed', 'failed', 'blocked'].includes(result.status), '父级suite状态无效', 50);
    if (result.counts) {
      object(result.counts, ['total', 'passed', 'failed', 'skipped']);
      for (const key of Object.keys(counts)) integer(result.counts[key], 0, 100000);
      requireThat(result.counts.total === result.counts.passed + result.counts.failed + result.counts.skipped, '父级用例计数不一致', 50);
    }
    requireThat(result.status !== 'passed' || result.counts?.total > 0 && result.counts.failed === 0 && result.counts.skipped === 0, '父级成功状态缺真实用例', 50);
    for (const key of Object.keys(counts)) counts[key] += result.counts?.[key] ?? 0;
  }
  return { status: results.every(result => result.status === 'passed') && counts.total > 0 ? 'passed' : 'failed', counts, partial: true, eligible: false, qualification: 'm1' };
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export function toJUnit(report) {
  const cases = report.suites.map(suite => `<testcase classname="${xml(suite.tier)}" name="${xml(suite.id)}">${suite.status === 'passed' ? '' : `<failure message="${xml(suite.reasons.join(','))}"/>`}</testcase>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="ops-ci-m1-partial" tests="${report.suites.length}" failures="${report.suites.filter(suite => suite.status !== 'passed').length}">${cases}</testsuite></testsuites>\n`;
}
