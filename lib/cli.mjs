import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envelope, NODE_VERSION, now, requireThat, runId, safeFailure } from './core.mjs';
import { parseArguments } from './ci/arguments.mjs';
import { runCi } from './ci/run.mjs';
import { exportEvidenceBundle, boundCommandResult } from './ci/evidence.mjs';
import { evidencePublicationRequest, publishEvidenceReceipt } from './ci/evidence-publication.mjs';

const controlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2)) {
  const startedAt = now();
  let id = runId();
  let args;
  let result;
  let reservedRun;
  let publication;
  let receipt;
  const controller = new AbortController();
  const interrupt = signal => { if (!controller.signal.aborted) controller.abort(signal); };
  const onTerm = () => interrupt('SIGTERM');
  const onInt = () => interrupt('SIGINT');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  try {
    publication = evidencePublicationRequest(process.env);
    args = parseArguments(argv);
    if (args.runId) id = args.runId;
    requireThat(process.version === NODE_VERSION, 'Node版本与控制工具链不匹配', 10);
    if (args.help) result = envelope('ci', id, startedAt, 0, 'ops ci [--profile fast|local|pr|release|extended] [--tier NAME] [--suite ID] [--scope PATH] [--file PATH] [--sha SHA] [--run-id ID] [--timeout DURATION] [--list|--explain] [--json] [--evidence-dir ABSOLUTE_DIRECTORY]');
    else result = await runCi(controlRoot, process.cwd(), args, id, startedAt, controller.signal, { onReserved: run => { reservedRun = run; } });
  } catch (error) {
    if (!args && error.evidenceDir) args = { evidenceDir: error.evidenceDir };
    const failure = safeFailure(error);
    result = envelope('ci', id, startedAt, failure.exitCode, failure.summary);
  } finally {
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
    if (args?.evidenceDir) {
      try {
        const exported = await exportEvidenceBundle(args.evidenceDir, result, reservedRun, publication?.invocation);
        result = exported.output;
        receipt = exported.receipt;
      }
      catch { result = { ...result, status: 'failed', exitCode: result.exitCode || 70, summary: '父级证据导出未能安全完成' }; }
    }
  }
  result = boundCommandResult(result);
  if (publication) {
    try {
      requireThat(receipt?.exitCode === result.exitCode, '父证据发布收据与最终退出不符', 70);
      await publishEvidenceReceipt(publication, receipt);
    } catch { result = { ...result, status: 'failed', exitCode: result.exitCode || 70, summary: '父级证据发布资格未能安全交接' }; }
  }
  result = boundCommandResult(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
  return result;
}
