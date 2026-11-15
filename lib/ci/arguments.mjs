import { identifier, PROFILES, relativePath, requireThat, TIERS, unique } from '../core.mjs';
import path from 'node:path';

export function parseArguments(argv) {
  requireThat(argv.length <= 256 && argv.every(arg => typeof arg === 'string' && arg.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(arg)), '参数大小或字符无效');
  const result = { command: 'ci', profile: 'local', tiers: [], suites: [], scopes: [], files: [], json: false, list: false, explain: false, help: false, sha: null, runId: null, timeoutMs: null, evidenceDir: null };
  if (argv.length === 1 && argv[0] === '--help') { result.help = true; return result; }
  requireThat(argv[0] === 'ci', '该命令尚未支持');
  const booleanFlags = new Map([['--json', 'json'], ['--list', 'list'], ['--explain', 'explain'], ['--help', 'help']]);
  const multiple = new Map([['--tier', 'tiers'], ['--suite', 'suites'], ['--scope', 'scopes'], ['--file', 'files']]);
  const scalar = new Map([['--profile', 'profile'], ['--sha', 'sha'], ['--run-id', 'runId'], ['--timeout', 'timeoutMs'], ['--evidence-dir', 'evidenceDir']]);
  const seen = new Set();
  try {
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    requireThat(booleanFlags.has(flag) || multiple.has(flag) || scalar.has(flag), '未知或不支持的参数');
    if (!multiple.has(flag)) { requireThat(!seen.has(flag), '单值参数重复'); seen.add(flag); }
    if (booleanFlags.has(flag)) { result[booleanFlags.get(flag)] = true; continue; }
    const value = argv[++index];
    requireThat(value && !value.startsWith('--'), '参数缺少值');
    if (multiple.has(flag)) result[multiple.get(flag)].push(value);
    else result[scalar.get(flag)] = value;
  }
  requireThat(PROFILES.includes(result.profile), '未知profile');
  for (const tier of result.tiers) requireThat(TIERS.includes(tier), '未知测试层级');
  result.suites.forEach(identifier);
  [...result.scopes, ...result.files].forEach(relativePath);
  [result.tiers, result.suites, result.scopes, result.files].forEach(values => unique(values, 'selector重复'));
  requireThat(!result.sha || /^[a-f0-9]{40}$/u.test(result.sha), '源码SHA必须是完整40位小写十六进制');
  requireThat(!result.runId || /^run_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(result.runId), 'runId无效');
  requireThat(result.profile !== 'release' || result.sha, 'release必须明确源码SHA');
  requireThat(!['pr', 'release', 'extended'].includes(result.profile) || result.tiers.length + result.suites.length + result.scopes.length + result.files.length === 0, 'CI profile禁止缩小门禁');
  if (result.timeoutMs !== null) {
    const match = /^(\d{1,7})(ms|s)$/u.exec(result.timeoutMs);
    requireThat(match, 'timeout必须使用整数ms或s');
    result.timeoutMs = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
    requireThat(result.timeoutMs >= 100 && result.timeoutMs <= 3600000, 'timeout越界');
  }
  requireThat(!(result.list && result.explain), 'list与explain不能同时使用');
  requireThat(!result.evidenceDir || path.isAbsolute(result.evidenceDir) && path.normalize(result.evidenceDir) === result.evidenceDir, 'evidence-dir必须为规范绝对目录');
  return result;
  } catch (error) {
    // 同一parser已解析且无歧义的安全目标可接收参数拒绝envelope，不再另行解析argv。
    if (seen.has('--evidence-dir') && !argv.slice(argv.indexOf('--evidence-dir') + 1).includes('--evidence-dir')
      && typeof result.evidenceDir === 'string' && path.isAbsolute(result.evidenceDir) && path.normalize(result.evidenceDir) === result.evidenceDir) error.evidenceDir = result.evidenceDir;
    throw error;
  }
}

export const selectorOf = args => ({ profile: args.profile, tiers: args.tiers, suites: args.suites, scopes: args.scopes, files: args.files });
