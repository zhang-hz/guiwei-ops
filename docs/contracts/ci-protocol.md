# CI 跨仓库协议

本协议由控制仓库维护。CLI `0.1.1`；registry、adapter report、父级 aggregate 的 `schemaVersion` 均为 `1`。应用 registry 固定为 `tools/ci/suite-registry.json`，应用测试、fixture 与 adapter 留在应用仓库。控制自测使用控制仓库自己的同路径 registry。机器契约为 [registry schema](../../schema/ci-registry.schema.json)、[adapter report schema](../../schema/ci-adapter-report.schema.json)、[父级结果 schema](../../schema/ci-result.schema.json) 和 [协议类型](../../schema/ci-protocol.d.ts)。schema 定义结构，实际文件、身份集合、计数与退出状态还需父级语义校验。本协议定义接入语义；受信与验收必须有独立审查和固定源码的真实运行证据。

## Runtime 与 CLI

控制器使用 Node.js `24.16.0` 内置模块和 ESM，不依赖应用 `node_modules`，不引入 npm 运行依赖。离线控制发行包必须携带平台对应的固定 runtime 与摘要。正式隔离验收宿主固定 `ubuntu-24.04` 托管 Runner，禁止在生产或共享开发数据库上测试。

公开入口为 `ops ci`。受信安装将 `ops` 映射到控制包 `bin/ops`（Linux）或 `bin/ops.ps1`（Windows），两者只将原始参数数组交给 `bin/ops.mjs`。参数解析唯一位于 `lib/ci/arguments.mjs`。工作区从当前目录确定，registry 路径不可由应用参数覆盖；不接受任意 shell/Compose/adapter/image 路径参数。未知或尚未实现的宿主运维命令返回非零，不模拟自检或部署成功。

参数白名单为 `--profile NAME`、可重复的 `--tier NAME/--suite ID/--scope PATH/--file PATH`、`--sha SHA`、`--json`、`--list`、`--explain`、`--help`、`--run-id ID`、`--timeout DURATION`。未知参数、缺值、重复单值参数、`--dry-run`、`--skip`、`--no-deps`、`--allow-failure`、`--update-snapshot` 均拒绝。timeout 只接受整数加 `ms` 或 `s`，在 100ms–3600s 范围内，取其与 suite deadline 的较小值，不能放宽 registry deadline；不设重试。`--run-id` 必须符合报告的 runId 格式，已有记录不能覆盖。无 profile 等于 `local`。同维 selector 取并集，不同维取交集，依赖随后补齐并按拓扑序运行；依赖执行完整文件集，不能被 `--file` 缩小。

## Registry

根字段严格为 `schemaVersion: 1`、`reportVersion: 1`、`suites: Suite[]`。Suite 必须包含下列字段，不接受额外字段。

```json
{
  "id": "registry",
  "tier": "integrity",
  "owner": "应用CI",
  "files": ["tools/ci/integrity.test.mjs"],
  "dependsOn": [],
  "profiles": ["fast", "local", "pr", "release", "extended"],
  "scopes": ["tools/ci"],
  "environment": "isolated",
  "adapter": { "runtime": "node", "entrypoint": "tools/ci/adapters/integrity.mjs", "args": [] },
  "resources": { "cpus": 1, "memoryMb": 512, "pids": 64, "outputBytes": 1048576 },
  "isolation": { "kind": "container", "network": "none" },
  "timeoutMs": 120000,
  "cleanupTimeoutMs": 15000
}
```

所有路径是 POSIX 仓库相对普通文件路径，禁止 glob、反斜线、绝对路径、`.`/`..`、符号链接和重复归属。`files` 不得为空；依赖 ID 必须存在且无环。文件实际存在、全局 suite ID/文件归属唯一、依赖闭环及 required 对账由语义校验完成，JSON Schema 不能替代这些检查。`environment` 只接受 `isolated`，不接受 dev/production。M1 仅支持无网络 Node adapter；需要临时服务资源的 suite 可以先登记，但选中执行时必须明确拒绝未实现的资源生命周期，不能连接共享开发库，也不能用登记成功冒充该 suite 已可运行。

层级为 `integrity/static/unit/module/database/contract/system/e2e/security/docs/nonfunctional`。profile 为 `fast/local/pr/release/extended`。参数 `--tier/--suite/--scope/--file` 可重复；依赖自动补齐。`pr/release/extended` 拒绝缩范围 selector；`release` 必须 `--sha` 完整 40 位 SHA。`--list`、`--explain` 只检查并列出，不执行测试。

## Adapter report

adapter 在唯一 `/out/report.json` 写 UTF-8 JSON：

```json
{
  "schemaVersion": 1,
  "runId": "run_00000000-0000-4000-8000-000000000000",
  "suiteId": "registry",
  "nonce": "0000000000000000000000000000000000000000000000000000000000000000",
  "tests": [{ "id": "拒绝未知键", "status": "passed" }]
}
```

上述全零身份只用于格式示例，不能用于实际运行。父进程生成 `run_<UUID>` 和每次调用独立的 32 字节随机 nonce（64 位小写十六进制）。父进程以 argv 数组 `['node', '--', '/src/<adapter.entrypoint>', ...adapter.args]` 启动内部 ESM adapter，cwd 为 `/src`，不经 shell。`files` 由 adapter 的既有发现器执行，不能把文件路径当新的公开入口。adapter 先检查调用描述与必需环境；缺少时拒绝直接启动。该检查只防误用，不建立安全信任。

测试专用环境只有 `OPS_RUN_ID/OPS_SUITE_ID/OPS_REPORT_PATH/OPS_REPORT_NONCE/OPS_SELECTED_FILES/OPS_SCOPE/OPS_SEED`；`OPS_SELECTED_FILES` 与 `OPS_SCOPE` 是 JSON 字符串数组，`OPS_SEED` 为控制父进程固定的十进制 seed 字符串并写父级报告。容器基础环境仅固定 `PATH=/usr/local/bin:/usr/bin:/bin`、`LANG=C.UTF-8`、`LC_ALL=C.UTF-8`、`HOME=/tmp`、`TMPDIR=/tmp`、`CI=true`。实际使用固定 `/usr/bin/env -i` 后执行 Node，不能继承镜像默认变量、宿主环境、registry 自定义 env、SSH agent 或云凭据。`OPS_REPORT_PATH=/out/report.json`。

测试状态仅 `passed/failed/skipped`；空 tests、重复 ID、skip、未知键、身份不符、报告缺失/坏 JSON/非法 UTF-8/超限/符号链接/硬链接、错误 owner/mode、exit 非零、信号、超时、输出超限、清理失败一律失败。报告必须由该 suite 非 root UID 创建为单链接普通文件，mode `0600`，大小上限为 1 MiB。不能附正文、堆栈、用户数据或秘密值。owner 与用例 ID 的长度单位为 Unicode 字符，不是 UTF-16 code unit。nonce 只绑定一次调用，不证明 adapter 可信；测试有效性还需独立审查与负向 canary。

adapter 不得写最终聚合，不可声明总通过或 required check。父进程独立读取实际进程退出状态，验证报告，计算用例数与结论。输出仅保存字节数与 SHA-256，不将未经脱敏的子进程输出写入公开报告。

## 父级 JSON、JUnit 与退出码

父级报告写入工作区 `.ops-ci/runs/<runId>/result.json` 与 `junit.xml`；adapter 只能写自己的 `/out`，不能写父级报告、policy 或其他 suite 的目录。`--json` 在 stdout 输出一份通用命令 envelope，CI 已开始编排时附 `ci` 字段，具体字段由 `CiResult` 类型冻结。预检失败仍返回通用 envelope，不能补默认健康状态。父级 JUnit 以 suite 为一个 testcase，失败原因仅用稳定代码；详细真实用例数见 JSON 的 `counts`，不能把 suite 数当用例数。

退出码固定为 `0` 所选范围执行成功、`2` 参数/schema 错误、`10` 环境/权限/隔离不匹配、`20` 等价成功并返回原证据、`30` 资源/锁不可用、`40` 外部依赖失败、`50` 门禁失败、`60` 数据/恢复失败、`70` 控制内部不变量失败。adapter 的真实 exit 单独记录，不原样当作 `ops` 的公共退出码。M1 即便 exit `0` 仍为 partial，不授予完整 CI 资格。

## 控制策略与资格

控制 policy 固定 required ID、tier、profile 和兼容版本；应用不能删 required、改其 tier/profile 或越过隔离安全边界。M1 应用资格仅要求 `registry` 与 `entrypoint-canary`；控制资格要求 `control-unit` 与 `control-canary`。应用 CI agent 可增加套件。M1 所有结果带 `qualification: m1`、`partial: true`、`eligible: false`，不可签发 `ops-ci/pr` 或 `ops-ci/release`。M1 没有经过校准的逐 suite required 预算矩阵，不能声称应用预算已经由完整外部 policy 锁定。全资产发现、覆盖率、安全、逐 suite 预算和完整 T0–T10 所需 policy 必须独立审查升级。

父级报告包含公共命令 envelope、CLI/control/policy/registry/report 版本、源码 HEAD 与 dirty 摘要、registry/policy SHA-256、开始结束 UTC、seed、selector、实际 suite 结果与清理证据。release 只接受匹配 `--sha` 的干净源码。控制身份在未固定 SHA 或 dirty 时明确标记候选，不自称受信。

正式受保护检查名称保留为 `ops-ci/pr` 与 `ops-ci/release`；全量 policy 生效后必须对同一准确源码 SHA、允许的固定 control SHA/policy 摘要、所有 required suite 实际执行和成功结果逐项对账。缺失、跳过、空跑、旧 SHA、check 名称不同均不合格。M1 workflow 只能报告候选资格，不能启用这些正式 required check 或签发应用发布证明。

## 资源与清理

registry 必须显式设置 CPU、内存 MiB、PID、合计 stdout/stderr 字节上限、执行 timeoutMs 和独立 cleanupTimeoutMs，不提供静默默认值。Schema 中的数值区间是控制输入的安全边界，不是经过校准的性能目标；上方 JSON 数字只演示字段形状，不作为正式 suite 预算或门禁基线。应用 CI owner 提出实际值并由控制 policy 审查固定，后续用真实 run 记录校准；不能以超时缩范围、重试抹除失败或降低画质。

执行 deadline 到达或收到信号时终止该次进程树与容器；cleanup deadline 从开始回收起独立计时，必须证明进程/容器和当次临时资源已回收。清理超时、确认失败或依赖清理异常使整体失败，并保留脱敏失败证据；不能只靠 adapter 自报 `cleanup: true`。M1 串行执行 suite；浏览器/3D 资源编排未实现时拒绝执行，不能从串行调度推导其隔离已满足。依赖失败时阻断相应分支，独立 suite 继续执行；收到进程中断时不再启动新 suite。

## 隔离与引导

应用源只读、每个 suite 独占输出、无外网、非 root、cap-drop、禁止提权、只读根、CPU/内存/PID/文件大小/输出/硬超时限制；不挂宿主 socket、SSH/cloud 凭据、控制仓库或父级报告目录。M1 只接受 Linux 本地 Docker Engine 和控制侧固定 manifest digest、image ID 的 Node 运行镜像；缺 Docker、镜像或隔离能力均拒绝执行，不能记绿。父进程预检不拉取镜像，预装只能由受审查 workflow 对固定 digest 执行。

源码快照以 Git 文件清单为源集合，不递归复制整个工作区；排除 `.git`、ignored 文件与嵌套仓库，拒绝链接、禁止的凭据文件及越界路径。快照有文件数量、单文件和总字节硬上限，复制前后校验内容摘要。控制自测只把自身受审查源码、lib 和 fixtures 放入只读 `/src`。

输出卷由 Engine 的 local tmpfs volume 提供，固定字节与 inode 上限；adapter 仅见独占 `/out`。只读、无网络、无源码挂载的保留容器维持该卷，在 adapter 真实退出后以固定读取程序检查报告类型/owner/mode/大小。父进程读取报告后依次删除 adapter、保留容器和输出卷，并通过 Engine list/inspect 独立确认不存在。`/tmp` 是每个容器独立 tmpfs。源码快照由父进程回收，CI 工作区锁名称为 `ci-workspace`，不代表生产全局变更锁。

首次资格流程为：非作者静态审查准确源码与摘要 → Git agent 显式提交控制路径固定 SHA → 从该 SHA 的固定 `ops ci` 入口编排 candidate canary/自测 → 记录真实结论。源码自身不签发信任。控制更新和应用更新分离；M1 不实现生产安装、签名验证或部署，相关命令显式拒绝。

## 控制自测与真实故障注入

`control-unit` 是普通隔离 suite，执行控制纯函数、文件系统、真实本地子进程及调度的单元反例。它不获得 Engine，也不能通过嵌套启动缺 Docker 的 `ops` 来声称验证容器拒绝链。

`control-canary` 保留相同 registry/report 版本，由控制父进程按控制目标的准确 ID 接到 `lib/ci/control-canary.mjs`。该父级 handler 属于固定控制源码；应用同名 suite 仍只走无特权 adapter。handler 使用固定控制 fixture 创建真实故障容器，读取真实 Engine 退出状态与 list/inspect 清理证据，解释每项反例的预期拒绝原因；依赖失败后的分支判断消费这些真实结果。报告由父级生成，`process: null` 明示该 suite 是父级控制编排，实际子进程与 Engine 状态保留在 `canaries[].actual`。普通应用报告不能写这些字段。

控制父级还对移除命令注入失败并查询实际残留，再执行回收；通过内部信号子进程发送真实 SIGTERM/SIGINT，最终由外层父级再次确认 Engine 资源不存在。内部信号子进程只是 `ops` 固定 canary 的执行部件，不是公开测试入口；workflow 不直接调用它。缺 Docker、容器未实际启动、仅有预期失败报告或缺少回收证明都不能使 canary 通过。任何这一层的实现声明仍需固定 SHA 上的真实运行和非作者审查。
