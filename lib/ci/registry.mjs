import path from 'node:path';
import { digest, identifier, integer, list, object, PROFILES, relativePath, requireThat, textValue, TIERS, unique } from '../core.mjs';
import { parseJson } from '../core.mjs';
import { readFileBounded, repositoryFile } from '../filesystem.mjs';

export const REGISTRY_PATH = 'tools/ci/suite-registry.json';
const SUITE_KEYS = ['id', 'tier', 'owner', 'files', 'dependsOn', 'profiles', 'scopes', 'environment', 'adapter', 'resources', 'isolation', 'timeoutMs', 'cleanupTimeoutMs'];

export function validateRegistry(value) {
  object(value, ['schemaVersion', 'reportVersion', 'suites']);
  requireThat(value.schemaVersion === 1 && value.reportVersion === 1, 'registry/report协议不兼容');
  list(value.suites, 4096);
  requireThat(value.suites.length > 0, 'registry没有suite', 50);
  const files = new Set();
  const ids = new Set();
  for (const suite of value.suites) {
    object(suite, SUITE_KEYS);
    identifier(suite.id);
    requireThat(!ids.has(suite.id), 'suite标识重复');
    ids.add(suite.id);
    requireThat(TIERS.includes(suite.tier), '未知测试层级');
    textValue(suite.owner, 128);
    unique(list(suite.files, 10000));
    requireThat(suite.files.length > 0, 'suite没有注册文件', 50);
    for (const file of suite.files) {
      relativePath(file);
      requireThat(!files.has(file), '测试文件重复归属');
      files.add(file);
    }
    unique(list(suite.dependsOn, 4096)).forEach(identifier);
    unique(list(suite.profiles, 5));
    requireThat(suite.profiles.length > 0 && suite.profiles.every(profile => PROFILES.includes(profile)), '未知profile');
    unique(list(suite.scopes, 256)).forEach(relativePath);
    requireThat(suite.environment === 'isolated', '禁止访问开发或生产测试环境', 10);
    object(suite.adapter, ['runtime', 'entrypoint', 'args']);
    requireThat(suite.adapter.runtime === 'node', 'M1只支持Node adapter', 10);
    relativePath(suite.adapter.entrypoint);
    list(suite.adapter.args, 32).forEach(arg => {
      textValue(arg, 256);
      requireThat(/^[A-Za-z0-9_./:=,@-]+$/u.test(arg) && !arg.includes('..'), 'adapter参数不在白名单');
    });
    object(suite.resources, ['cpus', 'memoryMb', 'pids', 'outputBytes']);
    integer(suite.resources.cpus, 1, 4);
    integer(suite.resources.memoryMb, 128, 4096);
    integer(suite.resources.pids, 16, 512);
    integer(suite.resources.outputBytes, 1024, 8 * 1024 * 1024);
    object(suite.isolation, ['kind', 'network']);
    requireThat(suite.isolation.kind === 'container' && suite.isolation.network === 'none', 'M1隔离能力不支持该suite', 10);
    integer(suite.timeoutMs, 100, 3600000);
    integer(suite.cleanupTimeoutMs, 100, 60000);
  }
  for (const suite of value.suites) requireThat(suite.dependsOn.every(id => ids.has(id) && id !== suite.id), 'suite依赖不存在或自环');
  topological(value.suites);
  return value;
}

export function topological(suites) {
  const byId = new Map(suites.map(suite => [suite.id, suite]));
  const visiting = new Set();
  const visited = new Set();
  const result = [];
  function visit(suite) {
    requireThat(!visiting.has(suite.id), 'suite依赖成环');
    if (visited.has(suite.id)) return;
    visiting.add(suite.id);
    for (const id of suite.dependsOn) {
      requireThat(byId.has(id), 'suite依赖未登记');
      visit(byId.get(id));
    }
    visiting.delete(suite.id);
    visited.add(suite.id);
    result.push(suite);
  }
  suites.forEach(visit);
  return result;
}

export function validatePolicy(policy, registry, target) {
  object(policy, ['schemaVersion', 'version', 'qualification', 'registryVersion', 'reportVersion', 'eligible', 'targets']);
  requireThat(policy.schemaVersion === 1 && policy.registryVersion === registry.schemaVersion && policy.reportVersion === registry.reportVersion, 'required policy版本不兼容', 50);
  requireThat(policy.qualification === 'm1' && policy.eligible === false, 'M1不能声明全量资格', 70);
  textValue(policy.version, 64);
  object(policy.targets, ['application', 'control']);
  requireThat(['application', 'control'].includes(target), '未知仓库目标');
  const required = list(policy.targets[target], 4096);
  requireThat(required.length > 0, 'required policy为空', 50);
  unique(required.map(item => {
    object(item, ['id', 'tier']);
    identifier(item.id);
    requireThat(TIERS.includes(item.tier), 'required tier无效', 70);
    const suite = registry.suites.find(candidate => candidate.id === item.id);
    requireThat(suite && suite.tier === item.tier && PROFILES.every(profile => suite.profiles.includes(profile)), 'required suite缺失或被降级', 50);
    return item.id;
  }));
  return policy;
}

export function selectSuites(registry, selectors = {}) {
  const { profile = 'local', tiers = [], suites = [], scopes = [], files = [] } = selectors;
  requireThat(PROFILES.includes(profile), '未知profile');
  const narrowed = tiers.length + suites.length + scopes.length + files.length > 0;
  requireThat(!['pr', 'release', 'extended'].includes(profile) || !narrowed, 'CI profile禁止缩小门禁');
  const byId = new Map(registry.suites.map(suite => [suite.id, suite]));
  for (const id of suites) requireThat(byId.has(id), 'selector suite未知');
  for (const tier of tiers) requireThat(TIERS.includes(tier) && registry.suites.some(suite => suite.tier === tier), 'selector tier未知');
  for (const file of files) requireThat(registry.suites.some(suite => suite.files.includes(relativePath(file))), 'selector file未登记');
  for (const scope of scopes) requireThat(registry.suites.some(suite => suite.scopes.includes(relativePath(scope))), 'selector scope未登记');
  const picked = registry.suites.filter(suite => suite.profiles.includes(profile)
    && (!tiers.length || tiers.includes(suite.tier)) && (!suites.length || suites.includes(suite.id))
    && (!scopes.length || scopes.some(scope => suite.scopes.includes(scope))) && (!files.length || files.some(file => suite.files.includes(file))));
  requireThat(picked.length > 0, 'selector没有匹配suite', 50);
  const requested = new Set(picked.map(suite => suite.id));
  const closure = new Set();
  const dependencies = new Set();
  function include(suite) {
    if (closure.has(suite.id)) return;
    closure.add(suite.id);
    suite.dependsOn.forEach(id => { dependencies.add(id); include(byId.get(id)); });
  }
  picked.forEach(include);
  return topological(registry.suites).filter(suite => closure.has(suite.id)).map(suite => ({
    ...suite,
    selectedFiles: !dependencies.has(suite.id) && files.length ? suite.files.filter(file => files.includes(file)) : suite.files,
    selectedScopes: dependencies.has(suite.id) ? [] : scopes.filter(scope => suite.scopes.includes(scope)),
    dependency: dependencies.has(suite.id),
  }));
}

export async function loadRegistry(root) {
  const bytes = await readFileBounded(path.join(root, REGISTRY_PATH), 4 * 1024 * 1024);
  const registry = validateRegistry(parseJson(bytes, 4 * 1024 * 1024));
  for (const suite of registry.suites) for (const file of [...suite.files, suite.adapter.entrypoint]) await repositoryFile(root, file);
  return { registry, sha256: digest(bytes) };
}
