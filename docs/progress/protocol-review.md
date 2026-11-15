# 控制平面首切片独立评审

日期：2026-11-15。角色：非作者 unit/contract reviewer；作者 Hypatia 已暂停，按静态交接输入审查。本文件是唯一写入范围；没有修改实现、schema、policy、测试或门禁。

## 输入身份与验证性质

- 控制仓库基线 HEAD：`010588837dec2c9fa48aa19b6aadfd6d784a9746`。交付文件均为该基线上的未跟踪文件，不能把基线 HEAD 当作交付源码 SHA。
- 输入清单：`docs/progress/protocol-source-manifest.json`，SHA-256：`efbdb881b0e28436ff99d49e55f03263028f705af40e80b3e7cd147a88991858`。首读与 final 交接前两次只读核对其 14 项文件的大小与 SHA-256，全部匹配，无输入漂移；清单不是签名或受信发行证明。
- 协议版本 `1`，CLI 目标 `0.1.0`，policy `m1.1`；候选实现实际位于 `lib/`，没有 `src/` 或 CLI 入口。
- 下列反例均为读取最终文件后的静态路径推导，未执行反例。没有运行 runner、测试、扫描、构建或远程操作；没有真实 `ops ci` 证据。作者自测也不能替代本次独立审查。

## 发现

### CP-01 · P2 · 同时被选中和被依赖的 suite 仍被缩小文件集

- 文件/行：`lib/ci/registry.mjs:112-124`；契约：`docs/contracts/ci-protocol.md:11`。
- 可复现条件：两个有效的 local suite：A 的 `files=[a1]`、`dependsOn=[B]`；B 的 `files=[b1,b2]`。调用 `selectSuites(registry, {files:[a1,b1]})`，其中 a1/b1/b2 代表各自有效、唯一且存在的仓库相对文件路径。
- 错误行为：A、B 均进入 `requested`，B 返回 `selectedFiles=[b1]`，漏掉依赖的 b2。
- 预期：B 因处于 A 的依赖闭包，应执行完整 `[b1,b2]`；显式选择身份不能覆盖依赖的完整执行要求。
- 根因：文件缩范围仅判断 `requested.has(suite.id)`，没有保留“也作为其他 suite 的依赖”的身份。
- 建议反例：同时选择根与依赖各一个文件；再覆盖多级/共享依赖和 registry 顺序交换。通过唯一 `ops ci` 入口执行并检查实际文件集，而非只检查 suite 数量。
- owner：Hypatia，C-01/C-02；应用 CI 接入 owner Mencius 需同步 selector 语义。

### CP-02 · P2 · 冻结的环境白名单无法满足权威契约中的 CI 标识

- 文件/行：`docs/contracts/ci-protocol.md:55`；依据：应用 `docs/architecture/operations/ci-test-strategy.md:149`。
- 可复现条件：后续隔离后端严格按第 55 行只注入七个 OPS 变量与六个基础环境变量；adapter/test-env 按权威策略在启动前检查 `CI=true`。
- 错误行为：容器没有 `CI`，合法 suite 的环境预检必然失败；若应用自行增加 `CI` 则违反被冻结的“只有”白名单。
- 预期：控制侧固定的非敏感 `CI=true` 与权威启动前校验能够同时成立，且不继承宿主环境。
- 根因：跨仓库环境协议遗漏权威策略必需的固定变量，不是要求本切片实现尚未交付的隔离后端。
- 建议反例：宿主 `CI=false` 或未设置时，子进程仍只收到固定 `CI=true` 和明确白名单；同时证明宿主秘密变量未继承。
- owner：Hypatia，C-01/C-02；知识契约同步 owner 与应用 CI owner Mencius。

### CP-03 · P2 · 聚合只核对数量，重复成功结果能够掩盖缺失 suite

- 文件/行：`lib/ci/report.mjs:37-43`；契约：`docs/contracts/ci-protocol.md:59,69,73`，应用 `docs/architecture/operations/ci-test-strategy.md:155`。
- 可复现条件：选定 suite 为 a、b；令 rA 为 a 的完整有效成功 `SuiteResult`，计数为 `{total:1,passed:1,failed:0,skipped:0}`。调用 `aggregateSuites([rA,rA], 2)`。
- 错误行为：返回 `status: passed`、total=2，而 b 没有结果；`partial: true/eligible: false` 虽然仍然保留，但“所选范围成功”的局部结论已经错误。
- 预期：拒绝重复 ID、遗漏、额外或错身份的结果；每一个被选择的准确 suite ID 都必须有且仅有一个结果。
- 根因：API 只收到 `selectedCount`，只比较数组长度，不能与选中 ID 集合逐项对账。
- 建议反例：`[a,a]` 替代 `[a,b]`；`[a,c]` 替代 `[a,b]`；缺一个结果；相同数量但未知 ID。保留全部准确成功结果作为正向对照，并经后续唯一 `ops ci` 编排 canary。
- owner：Hypatia，C-02；父级编排接线时不能把该 helper 现有的数量检查当成身份对账。当前没有 CLI，未声称已有可利用的正式 required-check 旁路。

### CP-04 · P2 · Unicode 长度的机器契约与实现不一致

- 文件/行：`lib/core.mjs:28-29`；关联 `schema/ci-registry.schema.json:34`、`schema/ci-adapter-report.schema.json:18`、`lib/ci/report.mjs:11`。
- 可复现条件：其余字段均合法。registry 的 owner 取 127 个“中”加一个 `😀`，或 adapter report 的 test.id 取 255 个“中”加一个 `😀`；报告的 runId/suiteId/nonce 与 expected 完全一致。
- 错误行为：JSON Schema 按 Unicode 字符计数，分别为 128/256，均在 maxLength 内；`textValue` 的 JavaScript `value.length` 分别为 129/257，拒绝这些按机器契约合法的输入。
- 预期：schema 与控制实现对同一 Unicode 输入给出一致的长度边界；所有权名称与用例名称没有被协议限定为 BMP 字符。
- 根因：JSON Schema 字符长度与 JavaScript UTF-16 code unit 长度被当成同一个单位。
- 建议反例：长度上限及上限加一，分别覆盖纯中文、包含一个非 BMP 字符和非 BMP 字符组合；由 schema 校验与实际控制校验同时判断同一输入，不能只镜像 `value.length` 写断言。
- owner：Hypatia，C-01/B-03；应用 CI owner 同步冻结的字符串长度语义。

## 已审查范围与静态判断

阅读应用根 `AGENTS.md`、整体计划中控制/CI 任务及共同质量闭环、`control-plane-design.md`、`ci-test-strategy.md`、`ci-release-design.md`；逐文件阅读交接、清单、协议、两个 JSON Schema、协议类型、policy/runtime 和全部七个新增 `lib/` 源文件。控制仓库 README、CODEOWNERS 与 ignore 规则仅作基线背景；没有把声明的仓库保护当成已验证的远程权限事实。

| 关注点 | 本输入能够支持的判断 | 证据边界 |
|---|---|---|
| 版本、未知键、路径 | registry/report 版本固定为 1；对象键集为精确匹配；路径拒绝绝对路径、反斜线、点段、`.git*` 和 `node_modules`；文件加载检查普通文件与链接 | 仅静态读取，未运行正反 schema/文件系统用例；不证明并发换链场景安全 |
| selector 与依赖图 | 实现同维并集、跨维交集、未知 selector 拒绝、CI profile 禁止缩范围、依赖存在性/自环/成环检查与拓扑顺序 | CP-01 仍破坏依赖完整文件集；尚无执行编排证明依赖失败后正确阻断 |
| required policy | 当前 policy 与校验器锁定 required ID、tier、全部五个 profile 和 M1 的 `eligible=false`；非 required suite 可以增加 | policy 没有每 suite 的时限/资源基准；现有代码不能证明协议第 69/77 行所述“应用不得降低时限、预算经控制策略固定”已经可执行。属于后续策略接线边界，不能拿 schema 的全局安全区间充当正式预算 |
| argv 与 shell | `boundedProcess` 使用 argv 数组和 `shell:false`；协议规定 Node 的 `--` 分隔符 | 固定 Node argv、Docker 参数与容器环境的实际组装尚未实现，不能由 helper 推断整条启动链已验证 |
| 报告绑定与拒绝分支 | `validateAdapterReport` 对比 expected 的 runId/suiteId/nonce，拒绝空 tests、重复用例 ID 和未知状态；`judgeSuite` 对非零真实 exit、signal、timeout、overflow、interrupted、skip、缺 counts、cleanupFailed/未确认清理有失败分支 | expected 的生成/格式验证、随机 nonce 生命周期、报告读取接线与真实进程状态来源尚未实现；CP-03 表明聚合仍缺准确 suite 身份对账 |
| 资格与首次引导 | 类型和聚合 helper 均保留 `qualification:m1/partial:true/eligible:false`；交接明确候选且不自证 | 没有正式 check、签名、安装或信任授予证据；固定提交与 canary 是后续步骤，不能由当前 review 自动替代 |
| 环境、secret、metadata | 配置解析固定环境身份与目录；secret parser 不用 source/eval，键集白名单、重复键与环境不符会拒绝，证据 helper 只输出键名/指纹/状态 | 文件 owner/mode 读取与命令调用还需接线；容器网络、metadata、无宿主凭据、无控制目录挂载等均只有协议，没有隔离后端实证。CP-02 待修复；只读 `/src` 还需证明不暴露工作区 `.env`/Git 凭据或嵌套控制仓库 |
| 资源与清理 | 数值均经安全整数与范围检查；协议明确示例数值不是正式 suite 预算，缺 Docker/固定镜像不能成功 | runtime image 为 null；执行/cleanup deadline、容器和临时资源回收尚无实现与证据。进程组检查不等于整棵进程树或容器已回收，不能以 `!cleanupFailed` 代替独立清理确认 |
| 并发与状态 | 状态采用临时文件、fsync、rename；租约恢复读取过期时间、进程身份与恢复回调，并保留孤儿租约 | `RunStore.begin` 的 load→rename 本身不是原子独占；接入命令须证明由相应 LeaseLock 串行保护，不能把 RunStore 独立当互斥入口。CLI 尚无调用者，不据此断言实际命令已发生危险并发 |

以上没有“测试通过”的含义。未实现且已清晰交接的能力，尤其缺 CLI 本身，不作为首协议切片缺陷。

## 首份 final 结论与后续门禁

首份 final 共登记 4 项 P2，未发现有充分输入支持的 P0/P1。协议足以继续准备 CLI、隔离后端和反例；CP-01～CP-04 修复并复审前，不能把本输入作为无异议的冻结跨仓库接入基线，更不能授予 M1 可信入口或完整 CI 资格。与这些接口无关的候选准备可继续，应用 CI 不应把当前候选字段/选择结果当成已验证能力。

当前真实 `ops ci` 执行数为 0；没有控制单元测试、契约测试或 canary 的真实结果。缺 CLI、测试和固定镜像符合交接所列未实现状态；本审查不要求首协议交接冒充完成 M1。

正式准入仍缺：

1. 作者修复上述反例；以新清单/摘要交接最终 diff，非作者复审变更及其影响。当前记录不是修复后复审，也不是正式通过。
2. 固定、可追溯且经审查的控制源码 SHA；完整 CLI/参数解析/工作区与源码 SHA 校验/预检/策略对账。运行 `release` 时验证准确干净源码；M1 仍保持 partial，不能签发正式 required check。
3. 固定 runtime 与 Linux Docker 镜像 digest；实际非 root、只读源、每 suite 独立输出、固定环境、无网络/metadata/宿主秘密/控制写权的隔离后端；缺能力明确失败。通过受信 snapshot 或明确挂载范围排除源根 `.git` 凭据、忽略的 secrets 和嵌套控制仓库；non-root 与只读均不代表敏感数据不可读。此项是下一实现验收边界，不对尚未实现的后端定性缺陷。
4. 父进程按准确 ID 聚合真实退出与报告；runId/每次随机 nonce、报告大小/链接/UTF-8/身份约束；唯一 run 记录、防覆盖、锁与幂等接线；执行及独立 cleanup deadline、进程/容器/临时数据回收证明。
5. 固定入口编排的控制 unit/contract/canary：故意断言失败、空跑、错身份、重复/缺报告、崩溃、真实 exit 非零、超时、输出超限、信号中断、逃逸/残留与清理失败均拒绝；正常路径同时有真实报告。禁止以独立 runner 填补入口缺失。
6. 记录准确 SHA/dirty 摘要、control/policy/registry/runtime 身份、selector、seed、真实计数、时间、进程退出与清理证据。全资产发现、T0–T10、覆盖率/安全/性能和正式 PR/release policy、workflow/权限/发行/签名/安装仍是后续门禁，不在本次验收范围。

## 输入清单记录

交付输入以 SHA-256 为 `efbdb881b0e28436ff99d49e55f03263028f705af40e80b3e7cd147a88991858` 的原始 `protocol-source-manifest.json` 为唯一逐文件索引，其 14 条记录全部已核对。补充知识输入如下；这些是当前应用工作树的内容身份，不声称均为已提交版本。

主 agent 告知 Arendt 正在准备真实 runtime digest 与 bootstrap YAML；这些后续交付不属于上述 14 项静态输入，不能视为本评审已覆盖。后续作者交接应给出包含它们的准确新输入身份。

| 应用仓库相对路径 | SHA-256 |
|---|---|
| `AGENTS.md` | `031002a7f5096395fef8925340d8929d299900900fcbac84164a00ccf150ff92` |
| `docs/progress/integrated-development-plan.md` | `f66d373980318d7d1de955ab07f5a95b8db057d3a5d0a499d87acce337bb6fac` |
| `docs/architecture/operations/control-plane-design.md` | `807349d35298d73a0b40e22d5e4a89201cfafb64ee51e89710e16f84a024c2fa` |
| `docs/architecture/operations/ci-test-strategy.md` | `7c48f99a645ccddda6606edf6745b70f1525426327db7c5638be94a6f77ac689` |
| `docs/architecture/operations/ci-release-design.md` | `87c42f83112b2ca0e28a460761be9cb4bbbf83fc97be1c4af680737eab16a1d6` |

正则审查说明：中途曾把其他正则引擎中 `$` 对末尾换行的行为套入当前 ECMAScript 正则；该反例已撤回，不列入发现。CP-04 的判断仅依据确切的 Unicode 字符/UTF-16 长度差异。

## 上报与范围状态

2026-11-15 已尝试用 `send_message_to_thread` 向主 chat `01a1db1b-e77b-7cd2-a4fc-db54e4dca4c2` 即时发送 CP-01。工具明确拒绝向 native ancestor 发送，当前工具目录没有可调用的 native collaboration messaging；因此用本指定文件及本 chat commentary 立即暴露发现，最终答复继续交接，不能声称消息已送达。该拒绝不是实现缺陷，也不授权修改其他文件或远程系统。

主 agent 已恢复并确认读到 CP-01、CP-02，要求收束 first final 后由作者修复/实现 CLI；不再尝试消息工具。当前文件记录的是该静态交接的首份 final；所有发现均待作者处理，修复后须对最终 diff 复审。本结论不构成 M1 或任务整体验收。
