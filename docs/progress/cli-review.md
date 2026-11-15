# 控制 CLI 首片非作者评审

日期：2026-11-15。作者：Hypatia；运行时与 workflow 作者：Arendt。两位作者按交接均已 final 暂停。评审角色：非作者 unit/contract/security reviewer；任务指定模型与推理档为 `gpt-6.1-sol/xhigh`，该标签不是执行证据。

本文件是本轮唯一写入。没有改实现、schema、policy、runtime、workflow、测试或旧 review，没有提交、push、创建 agent、连接开发/生产主机。以下反例全部是静态路径推导，未执行。实际 `ops ci` 执行数为 **0**；没有运行 Node 检查、测试、tsc、YAML parser、CLI、容器、浏览器或扫描器。作者自测不替代独立评审。

## 输入身份

控制仓库：`C:\Data\Code\Everything\tools\guiwei-ops`；读取的基线 HEAD 为 `010588837dec2c9fa48aa19b6aadfd6d784a9746`。候选源码尚未提交，基线 HEAD 不代表候选内容身份，也不构成信任来源。

| 输入 | 准确 SHA-256 | 核对结果 |
|---|---|---|
| `docs/progress/cli-source-manifest.json` | `0697d2db01ede0ede13517a3ac2ea6d8343e7e075b7ab56af81a5001aec17d73` | 与主 agent 指定值一致；41 项文件逐项核对字节数和摘要，全部匹配 |
| `docs/progress/cli-handoff.md` | `f4c25f12dc83df4d00b5d24cf6f15877c5b8b8f41bb36c814be1de83e00242a4` | 匹配 manifest |
| `docs/runtime-candidate.md` | `6c8a3c10e1fe373f550c5c5e32bbf7ba9be47381b4c917c0105898f504a56e44` | 与主 agent 指定值一致；追加只读来源核验 |
| `.github/workflows/control-bootstrap.yml` | `8029285dd2a1b27ed98a5090f204b106c3f2399e18adb79d4a1395ab63981a55` | 按主 agent 后续明确追加的输入核对匹配 |
| `docs/workflow-bootstrap.md` | `136fed7ed3ac32682be826d12ce04f887eb4fd84c1fa9528fd216aad951d648a` | 按主 agent 后续明确追加的输入核对匹配 |

41 项清单的 `externalInputs` 路径以应用仓库根解析，原有只读输入的字节数和摘要均匹配。清单生成时 `workflow-bootstrap.md` 标记 missing；本轮没有改清单，以主 agent 后续提供的两个准确摘要扩展评审范围，不把它们冒称为原 41 项。清单及本文都不是签名、受信发行包或资格证明。

已读应用根 `AGENTS.md`；整体计划第 0–4 节、B/C 任务与第 6–9 节的共同门禁；控制平面、CI 测试策略和 CI 发布设计；控制仓库跨仓库协议、原协议交接、清单及 `protocol-review.md`。整体计划中的其他产品泳道仅用于范围定位，没有扩展为生产安装或全量 CI 实现审查。应用 registry/adapter 只作接口对照，应用内部实现由 Carver 评审。

协议身份：CLI `0.1.1`，registry/report/result schema `1`，policy `m1.1`。限定入口为控制仓库根的 `sh ./bin/ops ci --profile local --json`；选择 `control-unit` 和父级真实 Engine `control-canary`，不依赖应用 T0 通过。

## 新发现

### CLI-01 · P1 · 负向 canary 能把未真正启动及额外控制失败计为预期成功

- 文件/行：`lib/ci/control-canary.mjs:23–30,57–62`；相关实际状态生成于 `lib/ci/docker.mjs:149–174`，宿主进程清理标记在 `lib/process.mjs:64–72`。
- 可复现条件一：对 `missing` 等预期坏报告的某一个子 run，使真实 `docker start --attach` 客户端在启动请求成功前失败；随后 Engine 可查询，容器仍为 `created`、`Running=false`、`ExitCode=0`、未有有效 StartedAt，清理成功。其他反例保持正常。这可由可信父级的启动故障注入复现，不需要应用取得 Engine 权限。
- 错误行为：`docker.mjs` 在检查 `State.Status === 'exited'` 之前已经赋值 `inspectEvidence`；检查失败后返回非空 inspect、`missing-or-invalid-report` 和额外控制错误。canary 用 `inspect !== null` 认定实际运行，又只要求坏报告原因与 inspect exit 0，因此可以 `accepted=true`，没有启动 adapter 的失败被计为 canary 成功。`actuallyRan` 分支没有核对 inspect 的有效启动时间或终态，且当前 inspect 摘要未保留这两项完整状态。
- 可复现条件二：让 timeout 子 run 保留真实启动证据、`timedOut=true`、`process.cleanupFailed=true`，同时容器/卷的独立清理成功。这是宿主进程树清理失败与 Engine 资源回收成功两项不同证据；`boundedProcess` 与 `judgeSuite` 明确能够形成此组合。
- 错误行为：理由包含 `timeout` 与 `cleanup-failed`，但预期检查只查 `timeout`，`cleanupConfirmed` 只累计 Engine cleanup.confirmed，仍可把额外宿主清理失败吞成通过。同类逻辑也没有排除额外 `memory-limit`、controller-error 等非预期失败。
- 预期：预期坏报告必须先有真实启动、真实退出及准确拒绝链；预期超时可以作为负向试验成功，但额外宿主清理失败、OOM、非预期控制错误不能被预期原因掩盖。所有原始子 run 记录继续保留，整体返回非零。
- 根因：将“存在 inspect 对象”当作运行证明，并以理由包含预期项代替对真实状态和全部失败原因的封闭核对。
- 建议反例：真实 Engine 上对单个坏报告模式注入 start 客户端失败，断言未启动不得 accepted；再经控制 unit 与真实父级 canary 分别覆盖 `timeout + process.cleanupFailed`、预期拒绝加 OOM/额外控制错误；以完整正常正反例为对照。纯 mock 只能证明判定函数，不能替代实际启动/清理闭环。
- owner：Hypatia，C-02/C-03/B-06。**阻断当前输入的 bootstrap 准入结论。**没有声称实际发生过这类 Engine 故障。

### CLI-02 · P1 · 干净 SHA 检查与快照内容没有绑定在同一次源码身份中

- 文件/行：`lib/ci/source.mjs:33–58,64–71`；消费点 `lib/ci/run.mjs:54–58,69–76,88–89`。
- 可复现条件：从匹配 `--sha S` 的干净应用 checkout 开始；在 inventory 已读完 HEAD/status、尚未读取某个普通源文件时，由并行编辑者修改该文件，之后保持新内容稳定；registry 不变。固定控制源码与 Engine 均正常。
- 错误行为：inventory 记录 `commitSha=S, dirty=false`，内容摘要却取修改后的文件；createSnapshot 只与该修改后摘要比对，因而成功。pr/release/extended 的干净检查及 release SHA 比对均可通过；报告把未属于 S 的执行快照标为 S 的干净源码。控制 inventory 也使用相同的先 status 后读内容流程。CI 工作区锁在 inventory 之后取得，且不能约束普通编辑者。
- 预期：声称干净且匹配准确 SHA 的运行必须执行该 Git 对象对应的源码；并发漂移要在执行前拒绝，不能只证明两次读取的修改后字节相同。local 若接受修改内容，身份应准确标 dirty。
- 根因：HEAD、status 与文件摘要分时采集；没有把 clean 模式的文件集合、内容及执行位绑定回指定 Git tree，也没有在快照身份冻结时核对这个关系。复制阶段的摘要复核只覆盖 inventory 之后的变化。
- 建议反例：经 `ops ci` 编排的可信文件/Git fixture，在 status 与内容读取之间设置屏障再修改源文件，验证 release 拒绝、local 身份准确；另覆盖 HEAD/index 改变、文件增删、执行位变化。修复应建立准确对象到快照的绑定，不能只添加另一次仍可能竞争的 dirty 读取来声称原子保证。
- owner：Hypatia，C-02/B-04；Arendt 的固定 checkout 前置检查不能替代控制器内部的快照绑定。**阻断当前输入的固定 SHA bootstrap 准入结论。**该发现不声称 M1 已能生成正式 release。

### CLI-03 · P2 · 幂等状态未核对记录键与请求键，能够返回另一操作的成功证据

- 文件/行：`lib/state.mjs:7–16,24–35`。
- 可复现条件：RunStore 中操作 A 的有效 completed 记录保留内嵌 `key=digest(A)`；因文件复制、恢复映射错误或合法 JSON 状态损坏，该记录出现在 `digest(B).json` 下。请求 `begin(B, newRunId)`；文件 owner/mode 均正确。
- 错误行为：load(B) 仅验证内嵌 key 是 64 位摘要，没有与请求键 B 比较；begin 返回 `equivalent:true` 和 A 的原成功证据，B 没有执行。
- 预期：持久记录必须与被查询的操作键精确相等；错键状态按损坏拒绝，不返回等价成功。
- 根因：validateRun 缺少调用方期望键，load 也未对账。
- 建议反例：把 A 的完整成功记录放到 B 的文件名下，验证 B 拒绝且 A 仍可返回原证据；保留损坏 JSON 和同键幂等的现有正反例，经 `ops ci` 执行。
- owner：Hypatia，B-04。该发现针对已交付公共状态库；RunStore 尚未接入生产变更命令，不据此宣称存在生产幂等旁路。CI 同 runId 的 mkdir 独占拒绝不受此 helper 发现直接影响。

### CLI-04 · P2 · always 上传没有共用报告安全检查，链接与非唯一证据可进入 artifact

- 文件/行：`.github/workflows/control-bootstrap.yml:160–208`；文档声明 `docs/workflow-bootstrap.md:108,124–152`。
- 可复现条件：CLI 非零退出，失败现场中某个匹配 `.ops-ci/runs/run_*/result.json` 的路径为符号链接，指向 Runner 上可读的合成文件；或存在多个 run 的报告。也可在成功布局中将某个证据文件做成硬链接，或把 `$RUNNER_TEMP/ops-ci-bootstrap.stdout.json` 变成非空链接文件。这里只描述待由可信 fixture 编排的反例，没有制造文件或真实秘密。
- 错误行为：前序失败时存在性步骤默认跳过，`always()` 上传仍按 glob 收集；成功路径的检查也只对三个叶子文件用 `-L/-f/-s`，没有检查 nlink、全部父目录或 stdout 类型。官方固定 Action 的 `src/shared/search.ts:14–19,103–108` 设置 `followSymbolicLinks:true` 并使用 stat，因而不能依赖 Action 自动拒绝链接。失败 job 仍然保持失败，但上传内容边界已经失守。
- 预期：成功与失败均只上传经确认的父级普通单链接报告，绑定唯一的本次 run；预检尚无 run 时允许仅保留安全的父级失败 envelope，不能为补齐工件伪造成功。拒绝链接时仍保留原 CLI 非零结论。
- 根因：证据存在性检查与 always 上传是两套条件，上传消费未经过共同安全筛选的通配路径；“普通文件”判定遗漏硬链接与父目录身份。
- 建议反例：CLI 预检失败只有 envelope；执行失败但有完整报告；缺少任一文件；符号链接/硬链接/stdout 链接/父目录链接；多个 run。每项检查实际 artifact 文件集合，不能只验证 job 红灯或文件名匹配。不要求在 workflow 中另建 schema/测试 runner，应共用受审的证据导出边界。
- owner：Arendt，B-06 workflow；Hypatia 配合父级证据导出接口。当前审查没有证明 adapter 能直接写宿主报告，此项是失败证据上传守卫的缺口，不是已经发生的秘密外传。

## CP01–04 修复复审

| 旧发现 | 最终源码依据 | 本轮结论与证据边界 |
|---|---|---|
| CP-01 依赖被缩 files/scope | `lib/ci/registry.mjs:112–125` 用 dependencies 集合覆盖显式选择身份；`tests/ci/protocol.test.mjs:12–29` 覆盖根与依赖同时选择、多级共享与顺序交换 | 原静态反例已闭；依赖 files 为全集、scope 清空。用例尚未执行 |
| CP-02 缺 CI=true | `lib/ci/environment.mjs:6–9` 固定 13 项环境；`lib/ci/docker.mjs:24–27` 使用 env -i；protocol 测试与真实 environment fixture 检查白名单 | 原契约缺口已闭；实际容器环境未验证 |
| CP-03 聚合只对数量 | `lib/ci/report.mjs:38–55` 对 selected ID/tier、数量、重复结果及成功计数校验；调用点传 plan.selected | 原静态反例已闭；测试含 [a,a]/[a,c]/缺项/错 tier 与正例，尚未执行 |
| CP-04 Unicode 长度 | `lib/core.mjs:28–29` 按 code point；冻结 schema 语义保持一致；protocol 测试同时读取 schema 并调用独立对照解释器 | 原 UTF-16 反例已闭；BMP/非 BMP/边界反例已编码。未运行 schema 门禁，对照解释器不能当作已执行的标准验证器证据 |

“已闭”仅表示原 CP 的静态根因在准确输入中已消除，不表示真实 suite 或 M1 通过。旧 `protocol-review.md` 没有改写。

## 逐职责覆盖与未验证边界

41 项均已完整阅读；以下按 manifest 的实际文件分组说明，不用数量代替覆盖。

| 已读文件 | 可支持的静态判断 | 尚不能支持的结论 |
|---|---|---|
| `.gitattributes`、`.github/CODEOWNERS`、`.gitignore`、三个 bin wrapper、`lib/cli.mjs`、`arguments.mjs` | wrapper 转交 argv；唯一 parser；未知/重复 scalar/缺值、CI 缩范围和短 SHA 拒绝；未知生产命令显式失败 | 可执行位、Windows 实际 argv 和远程仓库保护未验证；未实现生产命令不列首片缺陷 |
| `registry.mjs`、`environment.mjs`、`report.mjs`、四个 schema/types、`ci/policy.json`、`tools/ci/suite-registry.json` | required 两种目标、依赖拓扑和完整选择、准确 suite 身份、nonce/UTF-8/计数/empty/skip/未知键拒绝；聚合保持 partial/eligible=false | 没有实际 schema/契约执行证据；逐 suite 正式预算矩阵与全量资产/T0–T10 不在已完成范围 |
| `source.mjs`、`filesystem.mjs` | Git 清单而非递归工作区；凭据路径、链接、文件数/字节上限拒绝；快照复制前摘要复核；文件句柄读取与原子落盘 | CLI-02 待修；目录逐级 lstat 后再 open 不构成目录换链的原子证明；tracked 凭据拒绝是文件名规则，不是 secret 内容扫描；当前应用嵌套控制目录由根 ignore 排除，不证明任意嵌套仓库都能无损排除 |
| `runtime.mjs`、`docker.mjs`、`ci/runtime.json` | 固定 Ubuntu24.04/Linux amd64/本地 socket、manifest 与 image ID；非 root、只读根与源码、独占输出、tmpfs、network none、capdrop、no-new-privileges；实际 exit/OOM/日志摘要、报告 owner/mode/nlink 与 Engine 清理路径已接线 | 没有真实 Docker flag/API/inspect/tmpfs volume/holder 的运行证据；资源限制与 cleanup deadline 是否实际生效必须引导验证，不因参数存在记通过 |
| `run.mjs`、`scheduler.mjs`、`process.mjs`、`state.mjs` | 同 runId 独占建目录；工作区锁和心跳；独立分支继续、依赖阻断；异常/中断/清理失败非零；坏 JSON 不补健康默认值 | CLI-03 待修；RunStore 不是公共变更事务/全局锁；宿主 helper 的进程组检查不能证明脱离进程组的整棵树消失，应用容器应以 Engine 独立回收对账为证；信号/崩溃竞态未执行 |
| `control-canary.mjs`、`tests/ci/canary.mjs`、`signal-parent.mjs` | 父级控制 handler 与无 Engine 的 unit 分层；应用同名 suite 不触发宿主 handler；每个反例原结果纳入 canaries；信号外父级再查 Engine，pending finally 有独立清理路径 | CLI-01 待修；负向判定未达到要求；父级 handler 的存在不能代替真实启动/故障/清理试验 |
| `tests/ci/{protocol,state,execution}.test.mjs`、`fixtures.mjs`、`schema-reference.mjs`、`unit-adapter.mjs`、`adapter-context.mjs` | 单元/契约/本地子进程反例与内部入口身份已编码，未发现通过缺 Docker 嵌套 ops 把容器反例刷绿的实现 | 所有反例未执行；缺少上述新发现的针对性用例；mock/参数检查不是实际 Engine 闭环 |
| `README.md`、`docs/contracts/ci-protocol.md`、`cli-handoff.md` | CLI/schema/policy、候选身份、命令及未实现边界一致；M1 明确 partial；生产 install/更新/发布/恢复不冒充可用 | README 与交接不是验收证据；应用知识文档同步与正式资格仍须各 owner 完成 |

对清理的判断仅限实际代码路径：backend finally 同时删除 worker、holder、输出卷，并对 Engine list/inspect 对账；源码快照随后回收。没有把“不见 PID”或 adapter 自报 cleanup 当成整棵进程树证明。清理命令/API 是否在硬期限内完成、异常路径是否无残留均未验证。

## Runtime 与 Action 来源的独立只读核验

本轮通过官方 HTTPS 端点回读公开字节与元数据；首次受限网络 DNS 失败后，使用已获自动审查许可的只读网络请求取得结果。没有输出 Registry 临时认证令牌，没有 pull、解包或执行候选。以下是来源/摘要核对，不是质量 runner。

| 对象 | 独立回读结果 | 准确含义 |
|---|---|---|
| Node 官方归档 | `node-v24.16.0-linux-x64.tar.xz`，HTTP 200，31,428,548 bytes；内存中重算 SHA256 `d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9` | 归档字节匹配候选；没有执行其中 Node |
| SHASUMS256.txt | 2,967 bytes，SHA256 `e20ebbf68d33f42d196a7a11b8a91d422fa37b759c0a51aa4857977135cc5e95`；linux-x64 行与归档重算值相同 | 官方 checksum 与实际归档一致 |
| 分离签名与固定公钥 | sig 119 bytes，SHA256 `cc94428d80ae6770e1bc4c36dd22e957910fc135cc33926c01ad504206a05d0d`；公钥 924 bytes，SHA256 `5115095e2f8010c75da052ecb1cfb3af630e084f0f8daa93a863557b01b0f90a`；公钥来自官方 release-keys 固定 commit `481637f813e912c4aa3622d7964ab426c97b8e8d` | 与 Arendt 交接字节一致；GOODSIG/VALIDSIG/TRUST_UNDEFINED 是作者交付证据，本轮没有重跑 GPG 密码学校验，不声称独立签名验真通过 |
| Docker OCI index | 5,201 bytes，重算 `sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203`；linux/amd64 descriptor 指向下项 | index 是多平台集合，不当作本 Runner 的平台 manifest |
| linux/amd64 manifest | 1,929 bytes，重算 `sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f`；指向 config d9e872… | 候选 image 固定的是准确 Linux amd64 manifest；没有使用发现 tag 执行 |
| image config | 6,826 bytes，重算 `sha256:d9e872c3ee59358dc71c3c99957c2d8ccd3f21419fee87b742faddcf00a6ecee`；os=linux、architecture=amd64、created=`2026-06-11T00:47:06.137921688Z` | image ID 是 config digest，不能与 manifest 混用；Config.Env 为 PATH、NODE_VERSION=24.16.0、YARN_VERSION=1.22.22；Volumes=null。声明的 Node 版本仍须实际容器 exec 验证 |
| actions/checkout | 官方 v7.0.1 tag 直接指向 `3d3c42e5aac5ba805825da76410c181273ba90b1`；commit API `verified=true/reason=valid`；release published_at=`2026-07-20T15:10:05Z` | 官方来源与固定引用匹配，不代表本 workflow 已执行 |
| actions/upload-artifact | 官方 v7.0.2 tag 直接指向 `cf430e030ddbb5b0abf93d22962f4752f3646cd9`；commit API `verified=true/reason=valid`；release published_at=`2026-10-07T10:08:14Z`；action.yml 使用 node24 | 官方来源与固定引用匹配；Action 采用自己的 Runner 运行时，不是 suite Node 版本的证明 |

可复核的 primary 端点：

- Node 归档与 checksum/signature：`https://nodejs.org/dist/v24.16.0/` 下对应文件。
- 固定公钥：`https://raw.githubusercontent.com/nodejs/release-keys/481637f813e912c4aa3622d7964ab426c97b8e8d/keys/5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc`。
- Registry：`https://registry-1.docker.io/v2/library/node/manifests/<上述准确digest>` 与 `blobs/<上述config digest>`；回读使用官方公开 pull 范围认证，令牌不记录。
- Actions：`https://api.github.com/repos/actions/checkout/` 与 `https://api.github.com/repos/actions/upload-artifact/` 下 `git/ref/tags/<上述版本>`、`commits/<上述SHA>`、`releases/tags/<上述版本>`。
- 上传链接行为：`https://raw.githubusercontent.com/actions/upload-artifact/cf430e030ddbb5b0abf93d22962f4752f3646cd9/src/shared/search.ts`。

本轮来源核验没有引入新的 runtime 摘要不匹配发现。固定包、Node/GPG 材料、Registry 和官方 Action 元数据仅支持候选来源；不证明镜像无漏洞、容器安全实效、三宿主兼容或正式签名信任。

## 追加 workflow 范围结论

两个新增文件已完整静态阅读。workflow 与 job 只声明 contents:read，没有 secrets/OIDC/发布写权限；checkout 固定完整官方 SHA、persist-credentials=false、不取子模块。Node 按准确归档摘要校验后安装在工作树之外；镜像按平台 manifest 预装并检查 config ID。controller 自己仍做运行时预检。

push 输入分别记录 event.after 为 sourceSha、github.sha 为 workflowSha、github.ref 为 workflowRef；source 使用完整 SHA checkout，再以实际 HEAD 和干净工作树核对。本轮 push 两个 SHA 可以相等，字段仍分开，没有因此登记误报。它们是来源身份，不自动成为受信授权；正式 dispatch/release 的历史/actor/签名校验不在本范围。

CLI 命令只出现一个质量入口，stdout 重定向后单独捕获 `$?`，常规路径中非零原样退出，没有 continue-on-error 或重试门禁；上传成功不会把原失败变绿。成功路径要求非空 envelope 与一份父级 result/junit/state；预检失败没有 run 时不会补造绿色报告。CLI-04 所述安全筛选缺口仍需修复。没有执行 YAML parser，也没有声称 Actions 平台接受该 YAML 或上传已经验证。

## 首份 final 与进入 bootstrap 的条件

本轮登记 **2 项 P1、2 项 P2**；没有足够证据登记 P0。CP01–04 的原静态反例已闭，新增发现尚待作者修复。当前输入不能给出“可直接进入固定 SHA bootstrap”的无阻断结论。

恢复条件：Hypatia 修复 CLI-01/02/03、Arendt 修复 CLI-04，补充对应最小反例并交准确新 manifest/workflow 摘要；非作者复审最终 diff，DS 系统 reviewer 核对实际隔离/权限/清理设计，再由 Git agent 显式路径冻结干净控制 SHA。来源候选值可继续用于这条准备链，但旧 review 不覆盖修复后的内容。

随后只由指定低权限 `ubuntu-24.04` bootstrap，从该固定 SHA 运行 `sh ./bin/ops ci --profile local --json`。必须保留父级 envelope、result/state/JUnit、准确 source/control/policy/registry/runtime 身份、实际 exit/计数/时间、每个负向子 run 的原始脱敏状态与独立 cleanup 证据；预期失败只有经可信父级核实完整拒绝链才能解释为负向试验成功。真实失败 run 永久保持失败，新 run 不能覆盖。

仍未验证：真实控制 unit/contract、实际 parent/Engine canary、信号/超时/OOM/残留与清理期限、Docker tmpfs/holder 与资源限制、workflow 平台执行和 artifact 集合、修复后源码、正式逐 suite 预算、全量 T0–T10、安全/供应链扫描、三宿主与生产安装/发布。应用 C-03 未因本审查完成。所有资格维持 partial、eligible=false；本文不构成 M1、正式 CI 或任务整体验收。

## 最终联合候选定向单元复审

日期：2026-11-15。修复作者：Ohm，按交接及主 agent 指令停写。复审角色为非作者 GPT 单元 reviewer；任务指定 `gpt-6.1-sol/xhigh`，此为指派标识，不另作工具模型路由证明。中途按用户要求冻结后，在同一会话恢复既定范围；没有派发 agent。本节只追加原报告，不改前文发现、实现、反例、workflow、manifest 或作者交接。

**结论：限定 CLI-01–04 最终修复与消费边界内，原四项静态根因已关闭，未发现新增确证静态阻断。** 此结论允许该冻结输入在独立系统复审也无阻断、Git owner 固定干净准确 SHA 后，进入指定低权限 GitHub Ubuntu 24.04 bootstrap，取得真实成功或失败证据；不等于 M1 通过、控制源码受信、B02–04/C01–03 整卡完成或生产准入。实际 `ops ci`、测试、构建、扫描、生成、CLI、容器、workflow 执行数均为 **0**；没有以底层 runner、语法检查或执行测试来证明测试。

### 输入身份与有限覆盖

- 最终 `cli-source-manifest.json`：53 项，SHA-256 为 `088631faa6cdac5de38631d3e66df23f0aa4fde3a5e87357b095779f76fa4664`；逐项读取文件元数据并重算摘要，53/53 的字节数及 SHA-256 匹配。该核对只是文件身份，不是质量门禁或签名。
- 最终 `cli-handoff.md`：`aafd2c291221f1c85529e862559c71731b73349b7ad44526f16aacd77066da70`；联合 workflow：`6bb5c42f9197e4e0381ae6e5c2a402e1fd04549e330a209211a8d4f853dcfcec`；workflow 说明：`5dfb870abb0bde4f851d6fd2e85f205fa60764e8b08978384bf1bfe068c3a2d1`；联合修复记录：`8f3c9288795b0e7995becb50913ebc5f092db20222aac257d479f266ef99f074`，均匹配最终清单。只以这些最终输入判断，原 49 项清单及旧 workflow 结论不授予本节资格。
- 读取并对照了根 `AGENTS.md`、`implementation-dispatch.md` 的控制复审与首次 Git/bootstrap 契约、本报告原 CLI-01–04 和原 `control-ci-system-review.md`；不等待并行系统 reviewer，也不代其给出结论。
- 完整阅读实际变更的实现与反例：`lib/{cli,core,process,state}.mjs`、`lib/ci/{arguments,control-canary,docker,run,source}.mjs`、`schema/{ci-protocol.d.ts,ci-result.schema.json}`、`tests/ci/{canary,execution.test,signal-parent,state.test}.mjs` 及最终 workflow。完整阅读九个新增路径：`lib/ci/{canary-verdict,evidence-files,evidence-publication,evidence,source-git}.mjs`、`tests/ci/{canary-verdict.test,evidence.test,source.test,source-parent}.mjs`。结合未改的文件 IO、报告聚合、runtime、环境白名单、单元 adapter、registry 和 bin wrapper 检查接线；文档按最终有效交接段对照。没有把 53 项摘要核对冒称为再次全面审查所有未改模块。
- `ci/runtime.json` 保持 `fc5176713851f18fa509749420e957b7242d484798dbce4f75eddc6abe050968`，固定 Node v24.16.0、Linux amd64 平台镜像及 config ID、Ubuntu 24.04 和两项 Action 完整 SHA。来源核验只沿用原报告的历史只读记录；本节未重新下载、联网验签或执行，不升级旧来源证据强度。

外部输入按应用根解析。复审采样时除下列三项外，`externalInputs` 均与清单匹配；下列是并行应用范围漂移，不进入控制 self-bootstrap 的两套 suite，本节没有审查其新实现或继承其旧结论，也不据此阻断控制自测：

| 外部路径 | 当前采样 SHA-256 |
|---|---|
| `docs/progress/ci-asset-inventory.md` | `0449b4305a3f1b66fbf11d708610fdaa095186b55f15ec6fbf5ead05d68eb179` |
| `docs/progress/implementation-dispatch.md` | `08817b9cf5594e573b994c3c6107c728d548e196bb50e0cc9f82de8e568100c8` |
| `tools/ci/suite-registry.json` | `329e845c2c5a027b8d98a240fe72e7cbbefe83819aac38ab5a60984c9878cedf` |

本报告追加前为 22,827 字节，SHA-256 `5f681795a2a5e1db8a257a2d9f15aafabc1985d9bd42ef14b6a1935cbb3af21e`；追加自然改变其作为 externalInputs 的摘要，不修改作者 manifest，也不声称追加后仍匹配旧 review 摘要。基线 HEAD `010588837dec2c9fa48aa19b6aadfd6d784a9746` 仍不是候选提交身份。

### CLI-01–03 原根因复核

| 原发现 | 最终源码依据与静态结论 | 执行证据边界 |
|---|---|---|
| CLI-01：未启动或额外失败被预期拒绝掩盖 | `canary-verdict.mjs:6–47` 要求有效启动时间、exited/非 running、合法结束时间、准确 Engine exit、无 OOM/Error，process/cleanup 终态一致；每个模式按无重复的完整 reasons 集合及准确 timeout/overflow/interrupted/client exit/signal/计数闭合。`docker.mjs:174–213` 分开保存 client exit 和独立清理期限内取得的 Engine 终态；读取器故障与坏报告分开。created 只由 `acceptStartFailure` 的独立故障试验解释，不能通过一般 missing 判定。原静态根因关闭 | 判定反例与真实 Engine start 前拦截、信号、rm 失败回收路径已读，均未执行。timeout 的附加 OOM/cleanup 标志明确只是判定边界注入，不是物理 OOM 或真实宿主残留证明 |
| CLI-02：SHA 与执行字节/mode 脱节 | `source-git.mjs:19–50` 读取准确 commit/tree、stage0 index 和名称集合；`source.mjs:22–88` 对实际 blob OID、集合及执行位标 dirty，采集前后与快照前后核对身份；clean 快照从已绑定 blob 读取二进制并核对大小/摘要/OID，mode 来自相同绑定。`run.mjs:57–88` 拒绝 dirty 控制入口，固定 helper 从该快照加载，快照 registry/policy 再对账。原静态根因关闭 | 已读真实 Git 父级反例和单元元数据模型，均未执行；模型不能替代真实 Git。已加载宿主 controller 仍依赖经审固定 checkout 与可信 Runner，不由自身摘要取得信任 |
| CLI-03：RunStore 请求 key 未对账 | `state.mjs:24–32` 在任何 begin 等价返回或 finish 消费前要求 `record.key === key`，错键转损坏非零；`state.test.mjs:46–55` 保留同键成功对照及 A 记录放入 B 路径的拒绝反例。原静态根因关闭 | 仅针对该公共状态库的已交付行为，不宣称生产幂等事务/所有后续控制命令已审或已实现；反例未运行 |

### CLI-04 完整导出与上传消费复核

父级 `runCi` 通过 reserve 回调提供唯一内存 run 对象（`run.mjs:65–67,115–125`）；CLI 的 finally 只消费该对象与内存结果（`cli.mjs:25–57`）。没有历史 run glob、stdout 文件发现或应用自报路径。源 result/state/JUnit 逐字节绑定父级内存终态及实际 suite/JUnit 摘要；导出封闭为四个固定文件名，安全失败子集显式列 gaps。

`evidence-files.mjs:23–108` 逐层固定 Linux 目录句柄，拒绝链接及不安全祖先，目标独占 mkdir；源/目标文件均受普通单链接、controller owner、0600、大小、inode 与读前后身份约束，独占写入、fsync 和回读，读写句柄有 finally 关闭路径。`evidence.mjs:29–106` 的 rejected 路径不产生收据；仅本次新建且仍安全的目录可以尽量保留失败 envelope，不覆盖既存目标。

`evidence-publication.mjs:14–127` 将 bounded、规范 base64、精确字段的版本1收据绑定到本次 invocation、准确目标 device/inode、run、最终 exit 和各文件字节/摘要；写入初始为空的私有 `GITHUB_OUTPUT` 普通单链接文件并复核。adapter 的固定环境没有该通道或 publication 端口。消费函数重新核对真实 shell exit、目录身份/0700、完整文件集合、文件0600/普通/nlink/大小/摘要及 envelope，并在 finally 关闭句柄。它是封闭 artifact IO，不调度质量 suite。

| 必查路径 | 最终静态行为 |
|---|---|
| CLI 之前失败、步骤未运行 | 无本次收据；IO 步骤跳过或失败，无法产生精确 ready，Action 不消费既有路径。若命令已被尝试但 CLI 本身未启动，shell 非零或 IO 拒绝仍使 job 失败 |
| 目标既存、叶子/父目录链接、导出 rejected | 不覆盖或删除既存目标；无收据；不能凭磁盘 JSON 自称 exported 上传 |
| 预检失败、未 reserve run | 只发布经边界确认的失败 envelope，收据 runId=null，必须非零；不合成 result/state/JUnit |
| 原执行失败且报告安全完整 | 导出四件、收据及 IO 核对后允许上传；原 exit50 等非零保持，上传成功不把 job 变绿 |
| 原成功缺 run/报告、报告不匹配/不安全/超限 | 原0转70，安全子集明确 gaps；不补造成功报告。若安全子集有完整收据且 IO 通过，可上传失败证据 |
| 错 invocation/目录/exit、坏或超限编码、重复/额外文件名 | 收据解码或集合/字节核对拒绝；无 ready，不上传 |
| 成功缺收据或通道交接失败 | CLI 原0转非零；即使目录存在，workflow 的 IO 核验也不能成功；原失败码保持非零 |
| 取消、超时及清理/落盘异常 | 已进入的 Engine 和父级执行路径保留独立 finally 清理；导出在 CLI finally。导出拒绝或未完成时不给目录资格，缺 shell exit/收据/完整 IO 时上传守卫拒绝；不承诺硬杀后还能完成导出 |

最终 workflow `:132–192` 只执行既定 `ops ci`，shell 单独记录 `$?` 且原非零原样退出；后续 IO 步骤有 always 条件，upload 同时要求 IO outcome=success 与 `evidence_ready` 精确等于 `true`，没有要求 ops_exit=0。ready 在公共验证函数返回且句柄关闭之后才输出。成功必须唯一 run 和四件完整；安全原失败与 incomplete 子集仍可保留。由此 CLI-04 原先“失败上传绕过共同安全边界”的静态根因关闭，没有发现该限定消费链中确证可达的新绕过或刷绿缺陷。

已读的反例经 `execution.test.mjs:9–17` 导入到原 control-unit 的固定入口；真实 Git 父级反例由固定 control-canary 调度，没有新公开 runner。反例文本、静态分支及 YAML 存在均不是实际 suite 或 artifact 证据。实际 Runner 的输出文件权限、失败 step 的跨步骤输出、取消时序、条件求值、目录句柄实效和上传最终集合，全部留给唯一 bootstrap 取证；未实跑不另列为一条静态缺陷。

### 可进入 bootstrap 的边界与准确未审范围

本单元复审没有要求扩大到其他控制命令、应用全部测试或全产品。独立系统 reviewer 消费同一冻结输入；两份复审均无阻断后，Git owner 按既定显式路径/属性/LF/可执行位核对并冻结新 40 位候选 SHA，向新控制仓库授权分支 push，以 `contents:read`、无生产 secrets/OIDC/发布写权的 Ubuntu 24.04 workflow 运行：

```sh
sh ./bin/ops ci --profile local --json --evidence-dir "$RUNNER_TEMP/ops-ci-evidence"
```

必须保留实际 source/workflow/control 身份、原 exit、计数、父报告和负向子 run 的独立清理证据；首次真实失败也是有效取证，不重写或覆盖成通过，以新 SHA/new run 修复复验。无 run 或导出拒绝时按上述安全边界处理，不为凑 artifact 放宽上传资格。bootstrap 即使0退出仍为 `qualification=m1, partial=true, eligible=false, trustStatus=candidate`。

明确未审/未验证：候选提交与远端实际分支保护、GitHub 平台执行和 Action 实际产物；真实 Git/Engine/信号/资源/OOM/脱组后代/清理期限及 Linux IO 实效；同 UID/root 恶意宿主在最终 IO 核验至 Action 打开之间换链；正式签名、控制安装/更新/锁恢复/发布/备份恢复等后续命令；应用并行 registry 新片、C03 整体迁移、全 T0–T10 与 D/G/H/J 业务、真实服务/数据库、三宿主及生产。收据不是签名；可信固定 controller、Runner 与无额外宿主写者仍是声明边界，不把假设当作已证实利用或已验证防护。

开发机已通及其 Ubuntu26/Docker29 差异只登记后续适配，不修改当前固定 GitHub Ubuntu24.04 准入，也不阻止其控制自测。README/跨仓协议仍有旧 CLI 0.1.1 文字，是已披露的后续文档同步项；实际命令、0.1.2 运行值、兼容 schema 与当前 workflow 对齐，未发现该文字在本 bootstrap 中改变执行的确证缺陷，不据此扩审或否定其余代码。

本节完成后停止写入。只有本报告追加；运行仍为 **0**。