import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../../lib/filesystem.mjs';
import { requireThat } from '../../lib/core.mjs';
import { loadRuntime } from '../../lib/ci/runtime.mjs';
import { DockerBackend } from '../../lib/ci/docker.mjs';
import { acceptCanary } from '../../lib/ci/canary-verdict.mjs';

const controlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const descriptor = await readJson(process.argv[2], 32768, { uid: process.getuid(), mode: 0o600 });
requireThat(descriptor.nonce === process.env.OPS_PARENT_NONCE && /^[a-f0-9]{64}$/u.test(descriptor.nonce), '内部信号反例缺父级身份', 10);
const controller = new AbortController();
const onTerm = () => controller.abort('SIGTERM');
const onInt = () => controller.abort('SIGINT');
process.on('SIGTERM', onTerm);
process.on('SIGINT', onInt);
const backend = new DockerBackend(await loadRuntime(controlRoot));
await backend.preflight();
let announced = false;
try {
  const result = await backend.execute(descriptor.suite, descriptor.context, { signal: controller.signal, onStdout: chunk => {
    if (!announced && chunk.toString().includes('ready')) { announced = true; process.stdout.write(`${JSON.stringify({ event: 'ready' })}\n`); }
  } });
  process.stdout.write(`${JSON.stringify({ event: 'result', result })}\n`);
  process.exitCode = acceptCanary(controller.signal.reason, result) ? 0 : 1;
} finally {
  process.removeListener('SIGTERM', onTerm);
  process.removeListener('SIGINT', onInt);
}
