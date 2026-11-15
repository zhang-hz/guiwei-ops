import fs from 'node:fs/promises';
import { requireThat } from '../../lib/core.mjs';

export function adapterContext() {
  requireThat(process.env.CI === 'true' && process.env.OPS_REPORT_PATH === '/out/report.json' && process.cwd() === '/src', '内部适配器只能由ops隔离调度', 10);
  requireThat(/^run_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(process.env.OPS_RUN_ID ?? '') && /^[a-f0-9]{64}$/u.test(process.env.OPS_REPORT_NONCE ?? ''), '适配器缺少调用身份', 10);
  return { schemaVersion: 1, runId: process.env.OPS_RUN_ID, suiteId: process.env.OPS_SUITE_ID, nonce: process.env.OPS_REPORT_NONCE };
}

export async function writeReport(context, tests) {
  await fs.writeFile('/out/report.json', `${JSON.stringify({ ...context, tests })}\n`, { flag: 'wx', mode: 0o600 });
}
