import { createHash, randomUUID } from 'node:crypto';

export const VERSION = '0.1.2';
export const NODE_VERSION = 'v24.16.0';
export const TIERS = ['integrity', 'static', 'unit', 'module', 'database', 'contract', 'system', 'e2e', 'security', 'docs', 'nonfunctional'];
export const PROFILES = ['fast', 'local', 'pr', 'release', 'extended'];
export const EXIT_CODES = [0, 2, 10, 20, 30, 40, 50, 60, 70];

export class OpsError extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = 'OpsError';
    this.code = code;
    this.reason = reason;
  }
}

export function requireThat(condition, reason, code = 2) {
  if (!condition) throw new OpsError(code, reason);
}

export function object(value, keys, reason = '结构字段无效') {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), reason);
  requireThat(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), reason);
  return value;
}

export function textValue(value, max = 256, reason = '字符串无效') {
  requireThat(typeof value === 'string' && [...value].length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value), reason);
  return value;
}

export function integer(value, min, max, reason = '数值越界') {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, reason);
  return value;
}

export function list(value, max = 10000, reason = '列表无效') {
  requireThat(Array.isArray(value) && value.length <= max, reason);
  return value;
}

export function unique(values, reason = '列表重复') {
  requireThat(new Set(values).size === values.length, reason);
  return values;
}

export function identifier(value) {
  textValue(value, 96);
  requireThat(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value), '标识符无效');
  return value;
}

export function relativePath(value) {
  textValue(value, 384);
  requireThat(/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u.test(value), '仓库路径无效');
  requireThat(!value.split('/').some(part => part === '.' || part === '..' || part.startsWith('.git') || part === 'node_modules'), '仓库路径越界');
  return value;
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parseJson(bytes, maxBytes = 1048576) {
  requireThat(Buffer.byteLength(bytes) <= maxBytes, 'JSON超过大小上限');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(typeof bytes === 'string' ? Buffer.from(bytes) : bytes));
  } catch {
    throw new OpsError(2, 'JSON无法解析');
  }
}

export const runId = () => `run_${randomUUID()}`;
export const now = () => new Date().toISOString();

export function safeFailure(error) {
  return error instanceof OpsError ? { exitCode: error.code, summary: error.reason } : { exitCode: 70, summary: '控制平面内部不变量失败' };
}

export function envelope(command, id, startedAt, exitCode, summary, evidence = [], environment = 'isolated') {
  requireThat(EXIT_CODES.includes(exitCode), '内部退出码无效', 70);
  return {
    schemaVersion: 1, command, runId: id, startedAt, finishedAt: now(),
    status: exitCode === 0 ? 'completed' : exitCode === 20 ? 'equivalent' : 'failed',
    exitCode, environment, summary, evidence,
  };
}
