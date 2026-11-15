import path from 'node:path';
import { object, requireThat, textValue, list, digest } from './core.mjs';

export const ENVIRONMENTS = Object.freeze({
  production: { hostId: 'guiwei-prod-vps', host: '106.15.89.180', domain: 'guiwei.zhanghaozhi.cn', root: '/srv/guiwei-prod', project: 'guiwei-prod', compose: '/etc/guiwei-prod/compose/production.yml' },
  dev: { hostId: 'guiwei-dev', host: '192.168.8.51', domain: 'guiwei.lan', root: '/srv/guiwei', project: 'guiwei-dev', compose: '/etc/guiwei/compose/development.yml' },
});

function absolutePosix(value) {
  textValue(value, 384);
  requireThat(value.startsWith('/') && !value.includes('\\') && path.posix.normalize(value) === value && !value.endsWith('/'), '宿主路径无效');
  return value;
}

export function validateConfig(value) {
  object(value, ['schemaVersion', 'environment', 'hostId', 'host', 'domain', 'paths', 'compose']);
  requireThat(value.schemaVersion === 1, '控制配置版本不兼容');
  requireThat(Object.hasOwn(ENVIRONMENTS, value.environment), '目标环境无效', 10);
  const expected = ENVIRONMENTS[value.environment];
  for (const key of ['hostId', 'host', 'domain']) requireThat(value[key] === expected[key], '环境身份不匹配', 10);
  object(value.paths, ['root', 'site', 'ops', 'secrets']);
  for (const [key, suffix] of Object.entries({ root: '', site: '/site', ops: '/ops', secrets: '/secrets' })) {
    requireThat(absolutePosix(value.paths[key]) === expected.root + suffix, '环境目录不匹配', 10);
  }
  object(value.compose, ['project', 'files']);
  requireThat(value.compose.project === expected.project, 'Compose项目不匹配', 10);
  list(value.compose.files, 1);
  requireThat(value.compose.files.length === 1 && absolutePosix(value.compose.files[0]) === expected.compose, 'Compose文件不匹配', 10);
  return value;
}

// 键集是服务权限边界；不在读取后把总密钥表转发给应用。
export const SECRET_POLICIES = Object.freeze({
  database: { file: 'prod-db.env', keys: { ENVIRONMENT: 'environment', POSTGRES_USER: 'name', POSTGRES_DB: 'name', POSTGRES_PASSWORD: 'secret' } },
  api: { file: 'prod-api.env', keys: { ENVIRONMENT: 'environment', SESSION_SECRET: 'secret' } },
  ai: { file: 'ai.env', keys: { ENVIRONMENT: 'environment', AI_API_KEY: 'secret' } },
  renderer: { file: 'renderer.env', keys: { ENVIRONMENT: 'environment', RENDERER_TOKEN: 'secret' } },
});

export function parseSecretDocument(bytes, service, environment) {
  requireThat(Object.hasOwn(SECRET_POLICIES, service), '服务密钥类别不支持');
  requireThat(Object.hasOwn(ENVIRONMENTS, environment), '密钥环境无效', 10);
  requireThat(Buffer.byteLength(bytes) <= 32768, '密钥文档超限');
  const result = Object.create(null);
  const policy = SECRET_POLICIES[service];
  for (const line of bytes.toString().split(/\r?\n/u)) {
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]{0,63})=([A-Za-z0-9_./:+@,=-]{1,4096})$/u.exec(line);
    requireThat(match !== null, '密钥格式拒绝shell语义');
    const [, key, value] = match;
    requireThat(Object.hasOwn(policy.keys, key) && !Object.hasOwn(result, key), '密钥键未知或重复');
    const type = policy.keys[key];
    requireThat(type !== 'environment' || value === environment, '密钥环境不匹配', 10);
    requireThat(type !== 'secret' || value.length >= 32, '密钥长度不合规');
    requireThat(type !== 'name' || /^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(value), '数据库名称无效');
    result[key] = value;
  }
  requireThat(Object.keys(result).length === Object.keys(policy.keys).length, '必需密钥缺失');
  return result;
}

export function secretEvidence(values) {
  return Object.entries(values).map(([key, value]) => ({ key, fingerprint: digest(value), status: 'validated' }));
}
