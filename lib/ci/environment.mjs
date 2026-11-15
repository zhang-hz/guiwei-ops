import { requireThat } from '../core.mjs';

export function adapterEnvironment({ runId, suiteId, nonce, files, scopes, seed }) {
  requireThat(/^run_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(runId), 'adapter运行身份无效', 70);
  requireThat(/^[a-f0-9]{64}$/u.test(nonce), 'adapter nonce无效', 70);
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', HOME: '/tmp', TMPDIR: '/tmp', CI: 'true',
    OPS_RUN_ID: runId, OPS_SUITE_ID: suiteId, OPS_REPORT_PATH: '/out/report.json', OPS_REPORT_NONCE: nonce,
    OPS_SELECTED_FILES: JSON.stringify(files), OPS_SCOPE: JSON.stringify(scopes), OPS_SEED: seed,
  };
}
