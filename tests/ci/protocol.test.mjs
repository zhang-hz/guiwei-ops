import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { textValue, parseJson } from '../../lib/core.mjs';
import { parseArguments } from '../../lib/ci/arguments.mjs';
import { validateRegistry, selectSuites, validatePolicy } from '../../lib/ci/registry.mjs';
import { validateAdapterReport, aggregateSuites, judgeSuite } from '../../lib/ci/report.mjs';
import { adapterEnvironment } from '../../lib/ci/environment.mjs';
import { checkSchema } from './schema-reference.mjs';
import { expected, profiles, registry, report, suite, suiteResult, successCounts, successProcess } from './fixtures.mjs';

export const cases = [
  ['CP01根与依赖同时缩文件仍执行依赖全集', () => {
    const b = suite('b', { files: ['tests/b1.test.mjs', 'tests/b2.test.mjs'] });
    const a = suite('a', { dependsOn: ['b'] });
    for (const suites of [[a, b], [b, a]]) {
      const selected = selectSuites(validateRegistry(registry(suites)), { files: ['tests/a.test.mjs', 'tests/b1.test.mjs'] });
      assert.deepEqual(selected.find(item => item.id === 'b').selectedFiles, b.files);
      assert.equal(selected.find(item => item.id === 'b').dependency, true);
    }
  }],
  ['CP01多级共享依赖的文件与scope不缩小', () => {
    const d = suite('d', { files: ['tests/d1.test.mjs', 'tests/d2.test.mjs'] });
    const a = suite('a', { dependsOn: ['b', 'c'] });
    const value = validateRegistry(registry([a, suite('b', { dependsOn: ['d'] }), suite('c', { dependsOn: ['d'] }), d]));
    const selected = selectSuites(value, { files: ['tests/a.test.mjs', 'tests/d1.test.mjs'], scopes: ['tests'] });
    assert.deepEqual(selected.map(item => item.id), ['d', 'b', 'c', 'a']);
    assert.deepEqual(selected[0].selectedFiles, d.files);
    assert.deepEqual(selected[0].selectedScopes, []);
  }],
  ['CP02宿主变量不能改变固定CI或继承秘密', () => {
    const previous = process.env.CI;
    process.env.CI = 'false';
    process.env.GUIWEI_SYNTHETIC_SECRET = 'not-a-real-secret';
    try {
      const value = adapterEnvironment({ ...expected, files: [], scopes: [], seed: '1729' });
      assert.equal(value.CI, 'true');
      for (const key of ['GUIWEI_SYNTHETIC_SECRET', 'NODE_OPTIONS', 'LD_PRELOAD', 'SSH_AUTH_SOCK']) assert.equal(Object.hasOwn(value, key), false);
    } finally {
      if (previous === undefined) delete process.env.CI; else process.env.CI = previous;
      delete process.env.GUIWEI_SYNTHETIC_SECRET;
    }
  }],
  ['CP03准确suite身份对账拒重复缺失额外错tier', () => {
    const selected = [suite('a'), suite('b')];
    assert.equal(aggregateSuites([suiteResult('a'), suiteResult('b')], selected).status, 'passed');
    for (const values of [[suiteResult('a'), suiteResult('a')], [suiteResult('a'), suiteResult('c')], [suiteResult('a')], [{ ...suiteResult('a'), tier: 'static' }, suiteResult('b')]]) assert.throws(() => aggregateSuites(values, selected));
  }],
  ['CP04Unicode边界同时满足schema与实际校验', async () => {
    const registrySchema = JSON.parse(await fs.readFile('/src/schema/ci-registry.schema.json', 'utf8'));
    const reportSchema = JSON.parse(await fs.readFile('/src/schema/ci-adapter-report.schema.json', 'utf8'));
    for (const owner of ['中'.repeat(128), '中'.repeat(127) + '😀', '😀'.repeat(128)]) {
      const value = registry([suite('a', { owner })]);
      checkSchema(value, registrySchema);
      validateRegistry(value);
      assert.throws(() => validateRegistry(registry([suite('a', { owner: owner + '中' })])));
      assert.throws(() => checkSchema(registry([suite('a', { owner: owner + '中' })]), registrySchema));
    }
    for (const id of ['中'.repeat(256), '中'.repeat(255) + '😀', '😀'.repeat(256)]) {
      const value = report([{ id, status: 'passed' }]);
      checkSchema(value, reportSchema);
      validateAdapterReport(value, expected);
      assert.throws(() => validateAdapterReport(report([{ id: id + '中', status: 'passed' }]), expected));
      assert.throws(() => checkSchema(report([{ id: id + '中', status: 'passed' }]), reportSchema));
    }
  }],
  ['参数白名单完整SHA与缩范围限制', () => {
    assert.equal(parseArguments(['ci']).profile, 'local');
    for (const args of [[], ['doctor'], ['ci', '--skip'], ['ci', '--profile'], ['ci', '--profile', 'fast', '--profile', 'local'], ['ci', '--file', '../x'], ['ci', '--profile', 'release'], ['ci', '--profile', 'pr', '--suite', 'a'], ['ci', '--timeout', '0s']]) assert.throws(() => parseArguments(args));
    assert.equal(parseArguments(['ci', '--timeout', '100ms']).timeoutMs, 100);
  }],
  ['registry拒未知字段路径重复环与生产环境', () => {
    validateRegistry(registry([suite('a')]));
    for (const value of [registry([suite('a', { unknown: true })]), registry([suite('a', { files: ['../x'] })]), registry([suite('a'), suite('a')]), registry([suite('a'), suite('b', { files: ['tests/a.test.mjs'] })]), registry([suite('a', { environment: 'production' })]), registry([suite('a', { dependsOn: ['b'] }), suite('b', { dependsOn: ['a'] })]), registry([suite('a', { dependsOn: ['missing'] })])]) assert.throws(() => validateRegistry(value));
  }],
  ['required不能被删改tier或移除profile', () => {
    const policy = { schemaVersion: 1, version: 'm1.1', qualification: 'm1', registryVersion: 1, reportVersion: 1, eligible: false, targets: { application: [{ id: 'a', tier: 'unit' }], control: [{ id: 'a', tier: 'unit' }] } };
    validatePolicy(policy, registry([suite('a')]), 'application');
    for (const value of [registry([suite('b')]), registry([suite('a', { tier: 'static' })]), registry([suite('a', { profiles: profiles.slice(1) })])]) assert.throws(() => validatePolicy(policy, value, 'application'));
  }],
  ['报告拒坏JSON身份未知键空跑重复用例假exit', () => {
    assert.throws(() => parseJson(Buffer.from([0xff])));
    assert.throws(() => parseJson('{'));
    for (const value of [report([]), { ...report([{ id: 'a', status: 'passed' }]), nonce: 'b'.repeat(64) }, { ...report([{ id: 'a', status: 'passed' }]), status: 'passed' }, report([{ id: 'a', status: 'passed' }, { id: 'a', status: 'passed' }])]) assert.throws(() => validateAdapterReport(value, expected));
    assert.equal(judgeSuite({ ...successProcess(), exitCode: 1 }, successCounts(), { confirmed: true }).status, 'failed');
    assert.equal(judgeSuite(successProcess(), { total: 1, passed: 0, failed: 0, skipped: 1 }, { confirmed: true }).status, 'failed');
    assert.throws(() => textValue('中\n'));
  }],
];
