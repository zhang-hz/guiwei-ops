import { now, safeFailure } from '../core.mjs';

export async function scheduleSuites(selected, execute, { signal, assertLock = () => {} } = {}) {
  const results = [];
  const byId = new Map();
  for (const suite of selected) {
    let result;
    const blocked = suite.dependsOn.some(id => byId.get(id)?.status !== 'passed');
    if (blocked || signal?.aborted) {
      result = { id: suite.id, tier: suite.tier, status: 'blocked', reasons: [blocked ? 'dependency-failed' : 'interrupted'], counts: null, process: null,
        cleanup: { confirmed: true, elapsedMs: 0, notStarted: true }, reportSha256: null, startedAt: now(), finishedAt: now() };
    } else {
      try { assertLock(); result = await execute(suite); assertLock(); }
      catch (error) {
        result = { id: suite.id, tier: suite.tier, status: 'failed', reasons: [`control-exit-${safeFailure(error).exitCode}`], counts: null, process: null,
          cleanup: { confirmed: false, elapsedMs: 0 }, reportSha256: null, startedAt: now(), finishedAt: now() };
      }
    }
    results.push(result);
    byId.set(suite.id, result);
  }
  return results;
}
