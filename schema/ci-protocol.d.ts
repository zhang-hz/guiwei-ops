/** 协议类型不承诺运行器已经可用；运行资格以独立审查与真实门禁证据为准。 */
export type Profile = 'fast' | 'local' | 'pr' | 'release' | 'extended';
export type Tier = 'integrity' | 'static' | 'unit' | 'module' | 'database' | 'contract' | 'system' | 'e2e' | 'security' | 'docs' | 'nonfunctional';
export type ExitCode = 0 | 2 | 10 | 20 | 30 | 40 | 50 | 60 | 70;

export interface Suite {
  id: string;
  tier: Tier;
  owner: string;
  files: string[];
  dependsOn: string[];
  profiles: Profile[];
  scopes: string[];
  environment: 'isolated';
  adapter: { runtime: 'node'; entrypoint: string; args: string[] };
  resources: { cpus: number; memoryMb: number; pids: number; outputBytes: number };
  isolation: { kind: 'container'; network: 'none' };
  timeoutMs: number;
  cleanupTimeoutMs: number;
}

export interface Registry {
  schemaVersion: 1;
  reportVersion: 1;
  suites: Suite[];
}

export interface AdapterReport {
  schemaVersion: 1;
  runId: string;
  suiteId: string;
  nonce: string;
  tests: { id: string; status: 'passed' | 'failed' | 'skipped' }[];
}

export interface Selector {
  profile: Profile;
  tiers: Tier[];
  suites: string[];
  scopes: string[];
  files: string[];
}

export interface Counts { total: number; passed: number; failed: number; skipped: number }

export interface EngineState {
  containerId: string;
  status: string;
  running: boolean;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  oomKilled: boolean;
  error: string;
}

export interface SourceIdentity {
  commitSha: string;
  dirty: boolean;
  /** 绑定commit/tree/index/文件集合/含执行位内容摘要；不是签名。 */
  sha256: string;
  treeSha?: string;
  indexSha256?: string;
  worktreeSha256?: string;
}

export interface EvidenceExport {
  /** rejected禁止消费目录；incomplete只证明所列安全文件，运行仍失败。 */
  status: 'exported' | 'incomplete' | 'rejected';
  runId: string | null;
  originalExitCode: ExitCode;
  files: ('envelope.json' | 'result.json' | 'state.json' | 'junit.xml')[];
  gaps: { name: string; reason: string }[];
}

export interface SuiteResult {
  id: string;
  tier: Tier;
  status: 'passed' | 'failed' | 'blocked';
  reasons: string[];
  counts: Counts | null;
  process: {
    exitCode: number | null;
    cliExitCode?: number | null;
    signal: string | null;
    timedOut: boolean;
    overflow: boolean;
    interrupted: boolean;
    cleanupFailed: boolean;
    outputBytes: number;
    outputSha256: string;
  } | null;
  cleanup: { confirmed: boolean; elapsedMs: number; removed?: boolean; absentFromEngine?: boolean; notStarted?: boolean; errors?: string[];
    containers?: { name: string; absent: boolean; observed: EngineState | null; terminal?: EngineState | null }[] };
  reportSha256: string | null;
  startedAt: string;
  finishedAt: string;
  inspect?: EngineState & {
    isolation: { imageId: string; user: string; network: string; readonlyRootfs: boolean; capDrop: string[]; securityOpt: string[]; memoryBytes: number; nanoCpus: number; pids: number; mounts: { destination: string; type: string; writable: boolean }[] } | null;
  } | null;
  canaries?: unknown[];
}

export interface CommandResult {
  schemaVersion: 1;
  command: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'equivalent' | 'failed';
  exitCode: ExitCode;
  environment: 'isolated' | 'dev' | 'production';
  summary: string;
  evidence: { path: string; sha256: string }[];
  evidenceExport?: EvidenceExport;
}

/** 预览仍须通过完整registry语义与required对账，不产生执行资格。 */
export interface CiPlanResult extends CommandResult {
  plan: {
    registryPath: 'tools/ci/suite-registry.json';
    target: 'control' | 'application';
    selector: Selector;
    selected: { id: string; tier: Tier; dependsOn: string[]; files: string[]; scopes: string[]; dependency: boolean }[];
    qualification: 'm1';
    partial: true;
    eligible: false;
    policySha256: string;
    registrySha256: string;
  };
}

/** CI 聚合由控制父进程生成；预检失败可以只返回通用 CommandResult。 */
export interface CiResult extends CommandResult {
  ci: {
    cliVersion: '0.1.1' | '0.1.2';
    control: SourceIdentity & { trustStatus: 'candidate' };
    source: SourceIdentity;
    policy: { version: string; sha256: string };
    registry: { schemaVersion: 1; reportVersion: 1; sha256: string };
    selector: Selector;
    seed: string;
    suites: SuiteResult[];
    counts: Counts;
    qualification: 'm1';
    partial: true;
    eligible: false;
    runtime: { image: string; imageId: string; nodeVersion: string; dockerVersion: string; runnerLabel: 'ubuntu-24.04' };
  };
  cleanup: { snapshotRemoved: boolean };
}
