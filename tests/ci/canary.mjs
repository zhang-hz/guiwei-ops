import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { adapterContext, writeReport } from './adapter-context.mjs';

const context = adapterContext();
const mode = process.argv[2];
const passed = [{ id: '实际反例', status: 'passed' }];
const write = tests => writeReport(context, tests);

async function connectionBlocked(host) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: 80 });
    const timer = setTimeout(() => { socket.destroy(); resolve(); }, 500);
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('连接不应成功')); });
    socket.on('error', () => { clearTimeout(timer); socket.destroy(); resolve(); });
  });
}

switch (mode) {
  case 'pass': await write(passed); break;
  case 'assertion': await write([{ id: '故意失败', status: 'failed' }]); break;
  case 'false-exit': await write(passed); process.exitCode = 7; break;
  case 'empty': await write([]); break;
  case 'missing': break;
  case 'invalid': await fs.writeFile('/out/report.json', '{', { mode: 0o600 }); break;
  case 'forged': await writeReport({ ...context, nonce: '0'.repeat(64) }, passed); break;
  case 'duplicate': await write([...passed, ...passed]); break;
  case 'extra-field': await fs.writeFile('/out/report.json', JSON.stringify({ ...context, tests: passed, status: 'passed' }), { mode: 0o600 }); break;
  case 'skip': await write([{ id: '未授权跳过', status: 'skipped' }]); break;
  case 'exception': throw new Error('故意抛出合成异常');
  case 'symlink': await fs.symlink('/src/ci/policy.json', '/out/report.json'); break;
  case 'hardlink': await write(passed); await fs.link('/out/report.json', '/out/duplicate.json'); break;
  case 'timeout': process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); break;
  case 'ready-wait': process.stdout.write('ready\n'); setInterval(() => {}, 1000); break;
  case 'output': setInterval(() => process.stdout.write('x'.repeat(8192)), 0); break;
  case 'tree':
    spawn(process.execPath, ['--eval', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' }).unref();
    setInterval(() => {}, 1000);
    break;
  case 'escape':
    for (const target of ['/src/ci/policy.json', '/src/parent/result.json', '/parent/result.json', '/out/../sibling/report.json']) await assert.rejects(() => fs.writeFile(target, 'forged'));
    for (const target of ['/src/.git/config', '/src/.env', '/src/tools/guiwei-ops/.git/config', '/var/run/docker.sock', '/root/.ssh/id_rsa', '/root/.aws/credentials']) await assert.rejects(() => fs.readFile(target));
    assert.ok(process.getuid() !== 0);
    await write(passed);
    break;
  case 'environment': {
    const allowed = ['PATH', 'LANG', 'LC_ALL', 'HOME', 'TMPDIR', 'CI', 'OPS_RUN_ID', 'OPS_SUITE_ID', 'OPS_REPORT_PATH', 'OPS_REPORT_NONCE', 'OPS_SELECTED_FILES', 'OPS_SCOPE', 'OPS_SEED'];
    assert.deepEqual(Object.keys(process.env).sort(), allowed.sort());
    assert.equal(process.env.CI, 'true');
    assert.equal(process.env.HOME, '/tmp');
    await write(passed);
    break;
  }
  case 'network':
    await connectionBlocked('169.254.169.254');
    await connectionBlocked('8.8.8.8');
    await write(passed);
    break;
  case 'file-limit': {
    process.on('SIGXFSZ', () => {});
    let limited = false;
    try { await fs.writeFile('/out/large', Buffer.alloc(2 * 1048576)); }
    catch (error) { limited = error.code === 'EFBIG'; }
    assert.equal(limited, true);
    await write(passed);
    process.exitCode = 9;
    break;
  }
  case 'output-quota': {
    const created = [];
    let limited = false;
    try {
      for (let index = 0; index < 256; index++) {
        const target = `/out/fragment-${index}`;
        created.push(target);
        await fs.writeFile(target, Buffer.alloc(65536));
      }
    } catch (error) { limited = ['ENOSPC', 'EDQUOT'].includes(error.code); }
    finally { for (const target of created) await fs.unlink(target).catch(() => {}); }
    assert.equal(limited, true);
    await write(passed);
    break;
  }
  default: throw new Error('内部canary模式无效');
}
