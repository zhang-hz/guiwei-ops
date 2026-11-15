export const profiles = ['fast', 'local', 'pr', 'release', 'extended'];
export function suite(id, extra = {}) {
  return { id, tier: 'unit', owner: '控制测试', files: [`tests/${id}.test.mjs`], dependsOn: [], profiles, scopes: ['tests'], environment: 'isolated',
    adapter: { runtime: 'node', entrypoint: 'tests/adapter.mjs', args: [] }, resources: { cpus: 1, memoryMb: 128, pids: 16, outputBytes: 1024 },
    isolation: { kind: 'container', network: 'none' }, timeoutMs: 1000, cleanupTimeoutMs: 1000, ...extra };
}
export const registry = suites => ({ schemaVersion: 1, reportVersion: 1, suites });
export const expected = { runId: 'run_00000000-0000-4000-8000-000000000000', suiteId: 'a', nonce: 'a'.repeat(64) };
export const report = tests => ({ schemaVersion: 1, ...expected, tests });
export const successProcess = () => ({ exitCode: 0, signal: null, timedOut: false, overflow: false, interrupted: false, cleanupFailed: false, outputBytes: 0, outputSha256: 'a'.repeat(64) });
export const successCounts = () => ({ total: 1, passed: 1, failed: 0, skipped: 0 });
export const suiteResult = id => ({ id, tier: 'unit', status: 'passed', reasons: [], counts: successCounts(), process: successProcess(), cleanup: { confirmed: true, elapsedMs: 1 }, reportSha256: 'a'.repeat(64) });
