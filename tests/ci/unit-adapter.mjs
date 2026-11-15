import { adapterContext, writeReport } from './adapter-context.mjs';
import { requireThat } from '../../lib/core.mjs';

const context = adapterContext();
requireThat(context.suiteId === 'control-unit', '控制自测suite身份不符', 10);
const selected = JSON.parse(process.env.OPS_SELECTED_FILES);
const allowed = ['tests/ci/protocol.test.mjs', 'tests/ci/state.test.mjs', 'tests/ci/execution.test.mjs'];
requireThat(Array.isArray(selected) && selected.length > 0 && selected.every(file => allowed.includes(file)) && new Set(selected).size === selected.length, '控制自测文件选择无效', 10);
const results = [];
for (const file of selected) {
  const { cases } = await import(`/src/${file}`);
  for (const [id, execute] of cases) {
    try { await execute(); results.push({ id: `${file}:${id}`, status: 'passed' }); }
    catch { results.push({ id: `${file}:${id}`, status: 'failed' }); }
  }
}
await writeReport(context, results);
process.exitCode = results.some(result => result.status !== 'passed') ? 1 : 0;
