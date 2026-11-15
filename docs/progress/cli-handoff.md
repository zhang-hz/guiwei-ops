# 控制 CLI 修复候选交接

日期：2026-11-15。本轮作者：Ohm，按 Lead 租约接替已暂停的 Hypatia；指定角色 GPT-6.1-sol / xhigh fix owner。Ohm 是本轮修改作者，不能对这些修改充任非作者 reviewer。本文交接 CLI-01/02/03 的候选修复及 CLI-04 控制端与workflow消费集成；发现是否关闭须由新的独立 GPT 与 DS 系统复审决定。

## 输入身份与写入边界

独立控制仓库为 `C:\Data\Code\Everything\tools\guiwei-ops`。读取的基线 HEAD 为 `010588837dec2c9fa48aa19b6aadfd6d784a9746`；候选仍含未提交文件，不能用这个 HEAD 代表当前候选。逐文件字节数、SHA-256 和输入见 `cli-source-manifest.json`；联合清单共53项，不包含自身，最终摘要另行交接。交接与清单重新冻结后，本作者停止全部写入，等待非作者GPT单元复审与DeepSeek系统复审。

前一轮输入为41项 manifest，摘要 `0697d2db01ede0ede13517a3ac2ea6d8343e7e075b7ab56af81a5001aec17d73`；原交接摘要 `f4c25f12dc83df4d00b5d24cf6f15877c5b8b8f41bb36c814be1de83e00242a4`。修复前已读 `cli-review.md`，其摘要 `5f681795a2a5e1db8a257a2d9f15aafabc1985d9bd42ef14b6a1935cbb3af21e`；DS报告在应用根 `docs/progress/control-ci-system-review.md`，摘要 `22f70c3756efd83e1109ef620d3e7f0c69330d75639be6f2c343e29b655c980d`，沿用同四项根因，旧审查不覆盖本修复。

CLI 0.1.2首次冻结49项manifest为 `934ad2a55c830b90a289ea8815de3b1cadc9a3956195f5fab2e6b2db1b25d52e`，handoff为 `f8fdc899babc6acfa5c6fa8246cdad0f7a5e0582864604f7df4df125d1070679`。本条在其基础上收口此前披露的always消费缺口，原workflow作者Ptolemy已停止写入；Lead把三个workflow文件的独占追加租约授予Ohm，没有等待另一owner。

已读根 AGENTS、整体计划的共同闭环及本片B/C任务、控制平面与CI知识契约、跨仓协议、原交接、系统评审及 implementation-dispatch 的首次 Git/bootstrap 契约。实际写入为 `lib/**`、`tests/ci/**`、必要兼容 `schema/**`、本文和manifest，加获追加租约的 `.github/workflows/control-bootstrap.yml`、`docs/workflow-bootstrap.md`、`docs/progress/bootstrap-workflow-fix.md`。没有修改runtime候选、任何review、应用、registry或policy；没有reset/stash/clean/提交/push、远程配置、新agent或生产操作。已有dirty/untracked保留。

## 版本与候选命令

CLI升为 **0.1.2**；registry/report/result **schema1**，policy保持 **m1.1**。结果schema/types兼容读取0.1.1并添加0.1.2的可选身份和导出字段；内部发布端口不增加公开CLI参数、artifact文件或报告schema。README、知识型跨仓协议中旧0.1.1文字不在本轮写入租约，需对应owner在后续文档同步时处理；workflow说明已同步0.1.2。本交接明确记录文档差异，不扩大应用schema或资格。

固定候选命令，cwd为经独立复审、固定SHA且干净的控制仓库；本作者未执行：

```sh
sh ./bin/ops ci --profile local --json --evidence-dir "$RUNNER_TEMP/ops-ci-evidence"
```

同一个 `ops ci` 的唯一parser增加可选单值 `--evidence-dir <规范绝对目录>`，没有新runner或第二质量入口。目标只影响父级证据导出，不影响selector、required或suite执行。固定control-unit和真实父级control-canary不等待应用T0、应用CI或业务修复。`--list/--explain/--help`不产生run，若同时要求evidence-dir，则不能以成功无run形成bootstrap成功，导出返回非零并记录缺口。参数本身歧义/过长/非法或尚未解析到安全目标时不能猜测导出路径；若唯一parser已解析无歧义的安全目标，后续参数拒绝也可保留失败envelope。

所有结果仍为candidate；有ci部分时始终qualification=m1、partial=true、eligible=false。

## CLI-01：严格运行与负向判定

- `lib/ci/canary-verdict.mjs` 为固定纯判定：真实Engine容器ID、StartedAt、Status=exited、Running=false、FinishedAt、实际ExitCode、OOMKilled=false、Error为空，同时精确匹配process与清理终态。每种模式完整核对reasons集合、真实exit、client exit/signal、timeout/overflow/interrupted、cleanupFailed、报告计数及摘要；未知或额外失败不被预期项解释。
- `lib/ci/docker.mjs` 在独立cleanup期限内先查询worker；必要时KILL并轮询exited，删除前保存终态，取得报告后再删除worker、holder、volume。StartedAt/终态保留在inspect和cleanup.containers[].observed/terminal；不把inspect非空、rm后不见容器或不见PID当真实运行/整棵进程树回收证据。
- 实际Engine exit与Docker client exit分别保留。超时、输出超限、信号取消不再因为执行deadline已结束而跳过终态读取，也不借generic control错误解释预期超时。清理读取失败、kill失败、额外OOM/Engine错误、宿主进程cleanupFailed均非零。
- 固定报告读取器以无链接、非阻塞句柄和1MiB上限读取；报告拒绝返回固定invalid形状，和读取器/Docker exec本身失败分开。只有前者可作为坏报告反例，后者是额外控制失败。
- `file-limit`反例捕捉真实EFBIG后写通过用例但显式exit9，父级必须确认该准确退出和拒绝链；异常模式固定exit1，false-exit固定7。
- `control-canary.mjs` 新增真实Engine创建后、start请求前的一次可信边界故障：截获准确start --attach，确认Engine仍created/未启动、一般missing判定拒绝，并真实回收。缺Docker、缺inspect或未执行不会使此项通过。
- timeout的额外cleanup/OOM/controller-error反例保留真实timeout原始记录，再生成明确标为 `injectionKind=verdict-boundary-only, physicalFaultVerified=false` 的变体；它们只证明封闭判定，**不是**实际OOM或宿主残留的物理注入证据。已有真实rm失败仍要求Engine实际残留、严格cleanup-failure形状和正常控制器独立回收。SIGTERM/INT内外父级使用同一严格规则并外部再查Engine。

原始失败子run都在canaries中保留；父级解释试验不会改写其status/reasons为passed。旧CP01依赖fullfiles/scope=[]、CP02 CI=true/env-i、CP03准确suite集合、CP04 Unicode code point未改写。

## CLI-02：准确Git对象绑定

`source-git.mjs` 在禁用replace对象、外部配置和hooks的受限环境中读取准确40位commit及对应tree，`ls-tree -r -z --full-tree <tree>`枚举100644/100755普通blob；索引按stage0精确枚举，冲突/链接/gitlink拒绝。Git原始输出按UTF-8严格解码路径；cat-file的源码字节走二进制捕获，不把stderr混入blob。

`source.mjs` 不再依赖status宣称clean：逐路径比较tree、index与实际工作树的文件集合、blob OID、执行位；本地增删、staged变化、内容和mode均形成准确dirty身份。采集前后核对HEAD/tree/index/名称身份；快照前后再次核对冻结身份。

**clean快照从准确tree已枚举的blob OID读取字节，并核对SHA-256/大小/OID，执行位来自固定tree。** 不是再次读取status来授信。dirty只执行已绑定工作树字节，并复核内容与mode。源码sha256绑定commit/tree/index/名称集合/含执行位的工作树摘要/dirty，父报告另公开treeSha、indexSha256、worktreeSha256。忽略的secret和当前被ignore的嵌套control不进入集合；合法`.env.example`及二进制文件保留。既有路径、文件数/大小/总量拒绝保留；文件名拒绝规则不是秘密内容扫描器。

控制self的内部信号helper从已经冻结的snapshot路径加载；应用执行时重新核对控制身份。当前已载入的host controller仍依赖Git owner提供固定干净checkout及可信宿主，不能由自身hash自证受信；这不是生产安装/可信更新实现。

## CLI-03：状态请求键对账

`RunStore.load(key)`在严格结构和普通文件读取后要求record.key与请求key精确相等；错键统一OpsError70。A成功记录放在B文件名下不能成为B的equivalent成功；A原证据的合法同键重放保留。RunStore仍只是公共状态库，不冒称生产变更事务已接线。

## CLI-04：确定的父证据接口

`runCi`通过onReserved把本次reserve成功的内存对象 `{id,directory,result,state}`交给CLI；finally只消费该对象和内存result。没有glob、查找历史run、读取shell stdout文件、信任应用自报路径或多run合并接口。工作区其他历史run不参与导出，不能把它们猜成本次run。

`evidence-files.mjs`仅在Linux逐级打开目录句柄，使用O_DIRECTORY/O_NOFOLLOW；通过已固定父句柄的 `/proc/self/fd`继续访问，并反查dev/ino/owner/mode，避免再次按可换链的绝对路径打开。祖先须root或当前controller所有、不可被其他用户写；root的sticky临时父目录可接受。目标父目录必须已存在，最终目录必须独占mkdir新建、owner为controller、mode0700，已有目标一律拒绝且不覆盖/删除。

源和目标证据均须controller所有、mode0600、普通文件、nlink=1、非链接，O_NONBLOCK避免特殊文件阻塞；读取前后及命名路径回查inode/size/mtime/ctime，写入独占创建、fsync、回读。固定上限：envelope/result各8MiB，state64KiB，JUnit1MiB。stdout直接输出同一个有界envelope，始终不把shell重定向文件作为来源；无evidence-dir时stdout也受8MiB上限，超限返回脱敏非零缺口说明。

| 情况 | 导出确定集合 | 退出与缺口语义 |
|---|---|---|
| 正常成功且run完整 | envelope.json、result.json、state.json、junit.xml | 保持0；evidenceExport.status=exported |
| 执行失败且父run完整 | 同四文件 | 保持原非零；result/state/JUnit保留原始失败，上传成功不刷绿 |
| reserve前预检失败 | 仅envelope.json | 保持原非零；runId=null、files只有envelope、status=exported只代表安全导出 |
| 已有run但尚无suite结果 | 安全result/state可保留，加envelope；无JUnit | 不合成JUnit；gaps记录not-produced-without-suite-results；保持非零 |
| 任一必须报告缺失、不匹配、超限、非普通或链接 | 只保留各自通过边界的固定文件，加失败envelope | status=incomplete；gaps逐项列出；原成功变70，原失败码保留 |
| 成功无run | 仅失败envelope | successful-command-without-run，非零 |
| 源父目录链接/无效 | 新建安全目标中仅失败envelope | 记录父目录及三个报告缺口，非零 |
| 目标存在、祖先链接/权限不安全、目标写入或最终回读失败 | 拒绝目录资格；仅在本次新建且仍安全时尽量留失败envelope | status=rejected，原非零不改成0；不可消费该目录 |

父result必须逐字节等于父级内存结果，state必须逐字节等于父级实际终态，JUnit与已知suite生成字节及result内摘要相等；不只检查runId或合法JSON。export后的envelope可多出evidenceExport，并在导出失败时为非零；原result和state不改成新结论。evidenceExport含status、唯一runId或null、originalExitCode、files和gaps。只允许上述四名，**没有附加manifest**。

### Workflow消费集成候选

此前无条件always上传无法区分CLI独占新建与已有目标。现由同一作者在追加租约中完成候选集成：CLI仅在本次新建且固定文件集合全部回读成功后，通过Runner私有step-output发出版本1有界收据；rejected、既存/链接目标无收据。收据绑定 `run_id:run_attempt:job`、准确目录device/inode、唯一run或null、最终exit与每件证据的大小/摘要，decoded JSON至多4096字节；它不是artifact第五文件，也不是数字签名。

内部端口 `OPS_CI_EVIDENCE_PUBLICATION=github-actions-v1` 与 `OPS_CI_EVIDENCE_INVOCATION` 只由受信controller掌握；普通本地ops命令不启用它，adapter白名单不含端口、收据或 `GITHUB_OUTPUT`。通道逐级父目录、普通单链接、owner、不可由他人写、初始为空及写后字节/身份均复核。shell另行记录真实ops_exit，原非零按原值退出。

always的封闭artifact IO步骤使用固定Node调用公共 `verifyEvidencePublication`，核对私有收据、当前调用、shell实际exit、同一目录inode/owner/0700、父目录、固定集合和各文件0600/普通/nlink/有界字节摘要，并核对envelope。函数不执行ops/suite/测试/schema/扫描；所有句柄关闭后，步骤才可输出ready。Action条件同时要求always、该步骤outcome=success、ready精确为true；不要求ops_exit为0。安全失败envelope或经过边界的失败子集可上传，job仍失败；CLI未运行、无收据、rejected、目录/文件漂移或IO拒绝均不进入Action。原成功缺件或缺收据必须非零。

输入与当前输出摘要见下节和联合workflow交接。CLI-04候选不再等待另一个workflow作者，但是否关闭仍须非作者GPT和DS复审。收据依赖受审固定SHA与可信Runner；最终核验到Action打开之间没有不可信宿主写者的前提须明确，不声称抵御同UID/root恶意进程在核验后换链。实际Runner权限、条件求值、跨步骤输出与artifact集合均未验证。

## 实际文件与反例

改动原文件：`lib/{cli,core,process,state}.mjs`、`lib/ci/{arguments,control-canary,docker,run,source}.mjs`、`schema/ci-result.schema.json`、`schema/ci-protocol.d.ts`、`tests/ci/{canary,execution.test,signal-parent,state.test}.mjs`，以及本交接与manifest。

新增：`lib/ci/{canary-verdict,evidence-files,evidence-publication,evidence,source-git}.mjs`，`tests/ci/{canary-verdict.test,evidence.test,source.test,source-parent}.mjs`。新增模块由已有execution.test导入的evidence.test覆盖，registry/allowed单元入口保持原样；host Git fixture仅由固定control-canary handler调用，应用adapter从未获得Git/Engine宿主权限。新源文件均不足800行。

追加租约修改三个workflow文件。固定命令、Runner、Node、镜像、Action完整SHA和只读token保留；身份字段分别使用source `github.event.after`、workflow `github.workflow_sha` 和 `github.workflow_ref`，实际HEAD仍核对source。公共IO边界位于 `lib/ci/evidence-publication.mjs`，CLI和workflow共用，未造第二质量入口。

| 调度层次 | 已编码反例 | 验证状态 |
|---|---|---|
| control-unit | timeout附加cleanup/OOM/controller错误/重复reason/时间或exit错配、created不算运行、各模式精确拒绝；错键状态；固定对象二进制/mode、HEAD/index/集合漂移；导出成功/失败/预检/缺件/软硬链接/父目录/错run/超限/非普通/旧run和stdout排除 | 全部未执行 |
| 固定父级Git | 真实临时repo固定commit/tree二进制及执行位；内容、HEAD/index、增删/mode漂移；采集阶段并发内容修改；ignored合成secret/嵌套control排除与合法source保留 | 已编码未执行；unit元数据模型不能替代这层 |
| 固定父级Engine | 保留原正反例；新增真实创建但拦截start前失败；严格真实timeout、信号、rm失败残留/独立回收；timeout额外边界标志反例分开标记 | 已编码未执行；无Docker不记通过，标志注入不冒称物理OOM/宿主残留 |
| workflow artifact IO | 本次收据及原exit；成功/失败/预检/缺件；无收据/既存/链接/未运行、旧调用/错exit/坏编码/重复额外名、目录inode/父链接/文件内容类型权限漂移、私有通道不安全 | 已编码未执行；静态消费候选等待独立复审；无实际artifact |

## 固定来源与外部冻结输入

`ci/runtime.json`保持原字节。Ubuntu24.04 / Linux amd64，Node `v24.16.0`，镜像 `docker.io/library/node@sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f`，config ID `sha256:d9e872c3ee59358dc71c3c99957c2d8ccd3f21419fee87b742faddcf00a6ecee`。archive SHA256 `d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9`。来源核对沿前轮独立metadata记录，本轮没有下载、拉取、执行或重跑GPG。来源摘要只支持候选来源，不等正式三宿主/全量扫描或受信资格。

| 追加租约前的输入基线（相对控制仓库） | SHA-256 |
|---|---|
| docs/runtime-candidate.md | 6c8a3c10e1fe373f550c5c5e32bbf7ba9be47381b4c917c0105898f504a56e44 |
| .github/workflows/control-bootstrap.yml | be353eff6610e066034f296f6f955347d62ce0fcd1ab23f89b687fbffe97ecaf |
| docs/workflow-bootstrap.md | 4728570c1e526d5bfa4ff44f69832324712ce4504a02297e68c64e2a026ebe7b |
| docs/progress/bootstrap-workflow-fix.md | c08c47eb810f78bf7646f031677a43803400e13321a5aa5011f0f7dab40d16a4 |

三个workflow旧身份按Lead指定值核对后，因独占追加租约产生以下当前输出；旧值不是当前文件摘要。runtime候选保持只读未改。

| 联合候选当前文件 | SHA-256 |
|---|---|
| .github/workflows/control-bootstrap.yml | 6bb5c42f9197e4e0381ae6e5c2a402e1fd04549e330a209211a8d4f853dcfcec |
| docs/workflow-bootstrap.md | 5dfb870abb0bde4f851d6fd2e85f205fa60764e8b08978384bf1bfe068c3a2d1 |
| docs/progress/bootstrap-workflow-fix.md | 8f3c9288795b0e7995becb50913ebc5f092db20222aac257d479f266ef99f074 |

这三项加入manifest.files；externalInputs保留当前准确身份并明确标为author-owned-integration-output，previousSha256保留追加租约前的基线，不冒充只读输入。externalInputs路径按应用根解析。应用侧并行文件若变化，只记录采样当前身份，不继承其旧review结论。

## 未验证与准入

实际 `ops ci` 执行数始终为 **0**。没有执行CLI、Node语法/测试、tsc、schema/YAML validator、容器、浏览器、扫描或独立runner；Git fixture虽已编码，本作者也没有启动。静态阅读、路径推导、行数和摘要不等质量通过，作者自查不能替代独立review。

尚无准确候选commit、Ubuntu真实Engine运行、容器资源/超时/信号/回收、Linux目录句柄实效、实际artifact或三宿主证据。不能声称CLI发现已独立关闭、M1通过、正式CI合格、C03完成或生产ops可用。普通host进程组观测不能证明脱组后代整树清理；安全边界仍依赖真实Engine与独立资源对账。生产安装、全部ops、应用迁移、全T0–T10、完整扫描/覆盖率/预算仍不在本片交付。

下一步：重新冻结本manifest后Ohm停止全部写入，由另一GPT审最终diff/准确身份；DS复审core和workflow联合候选，独立判断rejected/未运行及失败保留边界。无静态阻断后，由已授权Git owner按implementation-dispatch显式路径冻结干净SHA并push；指定低权限Ubuntu workflow从此SHA运行唯一候选命令，保留原失败与实际清理/计数，再进行actual-evidence独立复核。控制自测不等待应用CI；bootstrap即便0也保持partial/eligible=false。
