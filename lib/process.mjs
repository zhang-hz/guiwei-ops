import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { OpsError, requireThat } from './core.mjs';

export function restrictedHostEnvironment() {
  const result = { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) result[key] = process.env[key];
  }
  return result;
}

// 只向调用者返回有界字节；应用输出不会直接进入终端或证据。
export async function boundedProcess(executable, args, options = {}) {
  const { cwd, timeoutMs = 30000, outputBytes = 1048576, signal, env = restrictedHostEnvironment(), capture = false, binary = false, onStdout } = options;
  requireThat(Array.isArray(args) && args.every(arg => typeof arg === 'string' && !arg.includes('\0')), '子进程参数无效', 70);
  requireThat(!signal?.aborted, '运行已取消', 50);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform === 'linux', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { reject(new OpsError(40, '无法启动子进程')); return; }
    const hash = createHash('sha256');
    const chunks = [];
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    let interrupted = false;
    let cleanupFailed = false;
    let settled = false;
    let killTimer;
    const finish = (error, exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (error) { reject(error); return; }
      const captured = capture ? Buffer.concat(chunks) : undefined;
      resolve({ exitCode, signal: exitSignal, timedOut, overflow, interrupted, cleanupFailed, outputBytes: bytes, outputSha256: hash.digest('hex'), stdout: binary ? captured : captured?.toString('utf8') });
    };
    const kill = () => {
      if (!child.pid) return;
      try {
        if (process.platform === 'linux') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) { if (error.code !== 'ESRCH') cleanupFailed = true; }
      if (!killTimer) killTimer = setTimeout(() => finish(new OpsError(70, '子进程树清理无法确认')), 5000);
    };
    const consume = (chunk, stdout = false) => {
      bytes += chunk.length;
      hash.update(chunk);
      if (capture && stdout && bytes <= outputBytes) chunks.push(chunk);
      if (bytes > outputBytes && !overflow) { overflow = true; kill(); }
    };
    child.stdout.on('data', chunk => {
      consume(chunk, true);
      try { onStdout?.(chunk, child); } catch { cleanupFailed = true; kill(); }
    });
    child.stderr.on('data', consume);
    const abort = () => { interrupted = true; kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    child.on('error', () => finish(new OpsError(40, '子进程不可用')));
    child.on('close', (code, exitSignal) => {
      if (process.platform === 'linux' && child.pid) {
        try {
          process.kill(-child.pid, 0);
          cleanupFailed = true;
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) { if (error.code !== 'ESRCH') cleanupFailed = true; }
      }
      finish(undefined, code, exitSignal);
    });
  });
}

export function processSucceeded(result) {
  return result.exitCode === 0 && !result.signal && !result.timedOut && !result.overflow && !result.interrupted && !result.cleanupFailed;
}
