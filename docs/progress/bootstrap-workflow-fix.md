# 控制引导 Workflow 证据边界修复

日期：2026-11-15。角色：DS-MAX workflow fix owner。原 workflow 作者 Arendt 已暂停；本记录只交接可 review 候选，不授予 M1、required check、发布或生产资格。

当前接口说明见 [控制引导 Workflow](../workflow-bootstrap.md)。

## 输入与写入边界

已读应用根 `AGENTS.md`、`docs/progress/implementation-dispatch.md`、`docs/progress/control-ci-system-review.md`、控制仓库 `docs/progress/cli-review.md` 与 `docs/workflow-bootstrap.md`。本轮关闭的是系统复审 CLI-04 的 workflow 消费端。

只修改：

- `.github/workflows/control-bootstrap.yml`；
- `docs/workflow-bootstrap.md`；
- 新增本进度记录。

没有修改 CLI、lib、schema、runtime 来源、应用、根配置或其他作者文件；没有 reset、stash、clean、提交、push 或生产操作。工作树原有 dirty/untracked 内容保持原状。

## 修复内容

旧流程在成功时直接检查 `.ops-ci/runs/run_*`，失败时却由另一个 `if: always()` 步骤按 glob 上传，并且把 stdout 重定向成额外 artifact。两套消费路径没有共享链接、硬链接、父目录、唯一 run 或来源检查。

候选流程改为：

1. 固定调用唯一质量入口，并传入绝对证据导出目录；
2. 捕获 CLI 原始退出码，在摘要记录后按原值退出；
3. 不再重定向 stdout 为 artifact 文件；
4. 删除 workflow 中的 `.ops-ci` glob 和独立证据存在性检查；
5. `if: always()` 的 upload Action 只消费 `$RUNNER_TEMP/ops-ci-evidence`；
6. 目录缺失或为空时由 `if-no-files-found: error` 保持 job 失败。

CLI 在 `finally` 中从内存 envelope 和唯一已知 run 导出，逐级检查父目录并拒绝非普通文件、硬链接和链接。workflow 只消费已审核的确定目录，不补造报告，也不另建底层 runner。

## 精确 CLI 与输出接口

固定命令：

```sh
sh ./bin/ops ci --profile local --json --evidence-dir "$RUNNER_TEMP/ops-ci-evidence"
```

- `--evidence-dir` 必须是绝对目录；核心 owner 负责创建和校验唯一当次导出目录。
- stdout 只作为 CLI 安全 envelope，可在 job 日志查看，不成为 artifact 路径输入。
- 成功与执行失败使用同一个导出边界。
- 存在唯一已知 run 时，允许集合起点为 `envelope.json`、`result.json`、`state.json`、`junit.xml`，外加核心 owner 在最终交接中冻结的其他明确文件。
- 预检在预留 run 前失败时，只允许安全的失败 `envelope.json`。
- 多个 run、叶子链接、父目录链接、硬链接、非普通文件或来源不明文件必须拒绝导出。
- 导出拒绝不得改变原 `ops ci` 失败结论；能安全形成失败 envelope 时只保留该 envelope。
- workflow 保留原 CLI 退出码；artifact 上传成功不能把失败刷绿，上传失败也不能替换原退出码。

最终允许文件名、错误码和导出器内部实现以核心 owner 修复后的 manifest/handoff 为准。workflow 不重复实现该策略。

## 保持不变的安全输入

- GitHub Runner：`ubuntu-24.04`；
- Node：`v24.16.0`，归档 SHA-256 `d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9`；
- 镜像：`docker.io/library/node@sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f`；
- image config ID：`sha256:d9e872c3ee59358dc71c3c99957c2d8ccd3f21419fee87b742faddcf00a6ecee`；
- checkout Action：`3d3c42e5aac5ba805825da76410c181273ba90b1`；
- upload-artifact Action：`cf430e030ddbb5b0abf93d22962f4752f3646cd9`；
- permissions：仅 `contents: read`；无 secrets、OIDC、release、package、attestation 或写权限；
- push 候选分支仍为 `codex/integrated-development` 与 `main`；
- source SHA、workflow SHA、workflow ref 分开记录；
- 精确 checkout、HEAD/clean 检查和预拉固定镜像保持不变。

## 候选反例矩阵

| 场景 | 预期 CLI 输出边界 | 预期 workflow 结论 | 状态 |
|---|---|---|---|
| 正常成功 | envelope 加唯一当前 run 的完整允许集合 | 原退出码 0；只上传导出目录 | 待实跑 |
| 执行失败、已知 run | envelope 加当前 run 的报告集合，原始失败信息脱敏保留 | 原非零退出保持；安全证据可上传但 job 红 | 待实跑 |
| 预检无 run | 仅安全失败 `envelope.json`，不伪造报告 | 原非零退出保持；只上传 envelope | 待实跑 |
| 多个 run | 拒绝多 run 归属；必要时仅安全失败 envelope | 不按 glob 上传任何工作区 run；job 红 | 待实跑 |
| 证据叶子软链接 | 拒绝导出链接目标 | 不跟随链接；原失败保持；job 红 | 待实跑 |
| 证据叶子硬链接 | 普通文件 `nlink != 1`，拒绝 | 不把共享 inode 上传；原失败保持 | 待实跑 |
| 任一级父目录为链接 | 逐级父目录检查拒绝 | upload 不接收工作区路径；job 红 | 待实跑 |
| stdout 路径为链接 | workflow 不再创建、重定向或上传 stdout 文件，链接不能进入 artifact | 只存在日志流；job 结论不变 | 待实跑 |
| 导出目录不存在/为空 | CLI 未形成可上传证据 | `if-no-files-found: error`；即使 CLI 曾返回 0 也失败 | 待实跑 |
| CLI 成功但证据不完整 | 核心导出器或后续消费必须拒绝，不能补造 | 不刷绿；job 红 | 待实跑 |
| 安全失败 envelope 上传成功 | 只有 envelope | 上传步骤成功不改变原 CLI 非零；job 红 | 待实跑 |

反例必须由核心 owner 的控制测试经唯一 `ops ci` 编排；本 workflow owner 不直接运行 Node、Vitest、schema 解释器或独立测试脚本。

## 静态核对与文件摘要

本轮仅核对文件内容、精确搜索、Git 状态与 SHA-256；没有执行 workflow 或任何质量门禁。候选文件摘要：

| 文件 | 修复前 SHA-256 | 候选 SHA-256 |
|---|---|---|
| `.github/workflows/control-bootstrap.yml` | `8029285dd2a1b27ed98a5090f204b106c3f2399e18adb79d4a1395ab63981a55` | `be353eff6610e066034f296f6f955347d62ce0fcd1ab23f89b687fbffe97ecaf` |
| `docs/workflow-bootstrap.md` | `136fed7ed3ac32682be826d12ce04f887eb4fd84c1fa9528fd216aad951d648a` | `4728570c1e526d5bfa4ff44f69832324712ce4504a02297e68c64e2a026ebe7b` |

静态检查要求最终确认：

- workflow 中的唯一 `ops ci` 命令包含准确 `--evidence-dir "$RUNNER_TEMP/ops-ci-evidence"`；
- `Preserve parent CI evidence` 的 `path` 只有 `${{ runner.temp }}/ops-ci-evidence`；
- workflow 不再出现 `.ops-ci/runs/run_*`、`ops-ci-bootstrap.stdout.json` 或 stdout 重定向；
- 固定 Runner、Node、镜像、Action SHA 和 `contents: read` 未漂移。

## 尚待完成

1. 核心 owner 冻结 `--evidence-dir` 的最终允许文件名、预检失败 envelope 和导出拒绝语义；
2. 另一 GPT reviewer 独立复核本 diff，随后由另一 DS reviewer 复核系统边界；
3. Git agent 在干净候选上冻结准确 SHA；
4. 首次 push 到候选分支并由固定 `ubuntu-24.04` 低权限 workflow 实跑；
5. 实跑后核对 artifact 实际文件集合、唯一 run、原退出码、Engine 清理和失败保持，不以静态代码代替运行证据。

## 控制端与Workflow联合收口候选

日期：2026-11-15。作者：Ohm，GPT-6.1-sol / xhigh fix owner。Lead确认Ptolemy已停止写入后，将workflow、说明文档及本记录的独占追加租约授予Ohm。前段保留原作者历史输入；其无条件always消费及“关闭”表述不能作为联合候选的复审结论。本条替代当前消费语义，发现是否关闭由新的非作者GPT与DS系统复审决定。

输入为已冻结的CLI 0.1.2共49项候选，manifest SHA-256 `934ad2a55c830b90a289ea8815de3b1cadc9a3956195f5fab2e6b2db1b25d52e`、交接摘要 `f8fdc899babc6acfa5c6fa8246cdad0f7a5e0582864604f7df4df125d1070679`。三个workflow输入基线仍为 `be353eff6610e066034f296f6f955347d62ce0fcd1ab23f89b687fbffe97ecaf`、`4728570c1e526d5bfa4ff44f69832324712ce4504a02297e68c64e2a026ebe7b`、`c08c47eb810f78bf7646f031677a43803400e13321a5aa5011f0f7dab40d16a4`，分别对应workflow、说明文档和本记录。这些是修改前身份，不是当前文件摘要。

### 实现与资格边界

原缺口：目标在CLI之前已存在或为链接时，CLI正确拒绝覆盖；但无条件always Action仍可能上传这个原目标。CLI根本未执行时也不能把固定路径的存在当成本次证据。

联合候选保持原公开命令不变，使用两个层次的封闭artifact IO交接：

1. CLI从本次内存result/run出发独占新建目录，只复制安全固定集合，并对全部字节最终回读；仅此路径可产生版本1收据。rejected、既存或链接目标无收据。
2. controller内部环境端口将有界收据写到Runner私有 `GITHUB_OUTPUT` 的 `evidence_receipt`，绑定 `run_id:run_attempt:job`、准确目录device/inode、唯一run或null、exit、各文件大小和SHA-256。通道须是安全父目录下的普通单链接空文件，O_NOFOLLOW/O_NONBLOCK打开、fsync并回读；不从原始stdout或artifact JSON自称exported猜资格。
3. shell在ops返回后单独记录真实 `ops_exit`，原非零按原值退出；不使用continue-on-error、pipe或tee。
4. 后续always步骤使用固定Node调用公共 `verifyEvidencePublication`，只核对收据、实际exit、当前目录inode/owner/0700、逐级父目录、完整固定文件集合和字节摘要、普通/nlink/0600及大小、envelope对应关系。全部通过且句柄关闭后才输出ready。
5. upload条件为always且该IO步骤outcome=success、ready精确为true。没有 `ops_exit==0` 条件；安全失败envelope或经过边界的失败子集仍可上传，job继续失败。无收据、导出rejected、IO不安全或CLI未运行均不消费目录。

允许artifact集合封闭为 `envelope.json/result.json/state.json/junit.xml`。成功必须有run及完整四件；预检失败无run只有envelope；其他安全缺件子集保留gaps并非零，不合成成功报告。收据走私有通道，**不是第五个artifact文件**。envelope/result各8MiB、state64KiB、JUnit1MiB；收据decoded JSON上限4096字节，规范base64。

`lib/ci/evidence-publication.mjs`是公共IO边界，既用于导出端收据和通道，也用于workflow发布资格。inline Node只调用此函数，不运行ops、测试、suite、schema validator或扫描；这是封闭artifact IO验证，不是第二质量入口。相应反例继续由现有control-unit入口经ops ci编排，本作者未执行。

source/workflow身份分别使用 `github.event.after`、`github.workflow_sha`、`github.workflow_ref`，实际HEAD仍与source精确核对。Runner、固定Node归档、linux/amd64 manifest/config ID、两Action完整SHA、只读token和checkout无凭据保持原值；runtime来源未修改。

### 已编码而未执行的反例

| 条件 | 候选预期 |
|---|---|
| 正常成功、原exit50执行失败 | 收据与真实exit一致且四文件通过IO；前者0，后者仍50但可保留artifact |
| 预检失败无run | 非零，收据只绑定安全envelope |
| 原成功缺件 | 转70；可保留安全失败子集，不能形成成功资格 |
| CLI未运行、已有目标或目标链接、JSON自称exported | 无本次收据，无ready，Action不消费 |
| 旧run_attempt、错目标、错exit、坏/超限base64、重复/额外名 | 收据或IO拒绝，Action不消费 |
| 文件修改/删除、软硬链接、目录冒充普通文件、0600漂移 | IO非零，无ready |
| 目录被替换为另一inode，或父目录换成链接 | 即使内容相同仍拒绝 |
| Runner通道非空、软硬链接、父链接、可由其他用户写、非普通 | 拒绝交接；没有完整本次收据不能获资格 |
| 安全失败artifact上传成功 | 仅保留证据，不改变ops原失败；上传失败同样不能刷绿 |

上述均只是编码反例和静态路径推导，没有模拟Action或运行任何测试。GitHub失败步骤输出、Runner输出文件权限、真实目录句柄、条件求值和artifact实际集合均未验证。私有收据不是签名，依赖固定受审controller和可信Runner；最终IO核验与Action打开之间要求没有额外宿主写者，不声称抵御同UID/root恶意进程在核验后换链。adapter不获得该目录、通道或宿主环境。

### 联合候选摘要与后续

| 文件 | 本条候选 SHA-256 |
|---|---|
| `.github/workflows/control-bootstrap.yml` | `6bb5c42f9197e4e0381ae6e5c2a402e1fd04549e330a209211a8d4f853dcfcec` |
| `docs/workflow-bootstrap.md` | `5dfb870abb0bde4f851d6fd2e85f205fa60764e8b08978384bf1bfe068c3a2d1` |

本记录不嵌自身摘要，最终身份进入 `cli-source-manifest.json`；当前联合handoff见 `cli-handoff.md`。没有改review、runtime、policy、registry、应用、远程或生产，没有提交/push/reset/stash/clean。实际ops ci/workflow/底层检查执行数仍为0。

准确manifest冻结后Ohm停止全部写入，交另一GPT与DS审最终联合输入。无静态阻断后才由Git owner显式路径冻结干净SHA并进入低权限Ubuntu24.04 bootstrap。安全IO成立不等suite/M1合格，仍为partial、eligible=false。
