# 控制引导 Workflow

状态：可 review 候选。尚未提交、推送或运行；B-06 仍为 partial，不构成 M1 验收、required check 或发布信任。

## 1. 目标与触发

候选文件：`.github/workflows/control-bootstrap.yml`

唯一受审命令：

```sh
sh ./bin/ops ci --profile local --json --evidence-dir "$RUNNER_TEMP/ops-ci-evidence"
```

该命令在固定控制候选源码根执行 `control-unit` 与真实父级 Engine `control-canary`，输出必须保持 `qualification=m1`、`partial=true`、`eligible=false`。

触发范围只有 push：

```text
codex/integrated-development
main
```

首次候选资格利用 push 事件运行尚未进入默认分支的 workflow，避免“先合并才可测”的循环。它不是正式 PR/release 门禁。`workflow_dispatch` 需要 workflow 先存在于默认分支，因此留到候选 workflow 进入 `main` 后再评估；当前不使用 `pull_request` 或 `pull_request_target`。

## 2. 权限边界

workflow 与 job 均只声明：

```yaml
permissions:
  contents: read
```

不使用：

- repository/environment secrets；
- `id-token: write` 或 OIDC；
- `attestations: write`；
- `packages: write`；
- `contents: write`；
- GitHub Release/PR 写权限。

checkout 固定到官方 commit，并设置 `persist-credentials: false`。workflow 不创建 PR，也不依赖 Actions token 批准 PR。

## 3. 固定输入

### Actions

| 用途 | 官方版本 | 固定 commit |
|---|---|---|
| checkout | `actions/checkout v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| artifact upload | `actions/upload-artifact v7.0.2` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

官方来源：

- <https://github.com/actions/checkout/releases/tag/v7.0.1>
- <https://github.com/actions/upload-artifact/releases/tag/v7.0.2>

两个 commit 均通过官方 GitHub tag/API 回读，commit verification 为 valid。

### Runtime

| 输入 | 固定值 |
|---|---|
| Runner | GitHub 托管 `ubuntu-24.04`、Linux amd64 |
| Node | `v24.16.0` |
| Node 归档 SHA-256 | `d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9` |
| Container image | `docker.io/library/node@sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f` |
| Image config ID | `sha256:d9e872c3ee59358dc71c3c99957c2d8ccd3f21419fee87b742faddcf00a6ecee` |

Node 官方来源和签名证据见 [runtime-candidate.md](./runtime-candidate.md)。归档来源为 <https://nodejs.org/dist/v24.16.0/node-v24.16.0-linux-x64.tar.xz>；workflow 用固定 SHA-256 校验后解压到 `$RUNNER_TEMP`，不修改固定控制工作树。镜像来自 Docker 官方 Registry `library/node`，并由固定 workflow 以 digest 预拉；controller 不自动拉取其他镜像。

开发 Linux `srvdev` 是 Ubuntu 26.04.1，不满足控件当前的 Ubuntu 24.04 预检，不能用它绕过或替代本 workflow。

## 4. 身份绑定

push 事件分别记录：

```text
sourceSha   = github.event.after
workflowSha = github.workflow_sha
workflowRef = github.workflow_ref
```

三个值写入 step summary。checkout 使用完整 `sourceSha`，之后以 `git rev-parse HEAD` 核对实际 HEAD 完全相等，并要求工作树无修改。

`sourceSha` 与 `workflowSha` 即使本次 push 中相同，也不得合并成同一字段。后续从默认分支运行可信 workflow 时，二者可能不同。

## 5. 执行与退出语义

唯一质量动作是：

```text
sh ./bin/ops ci --profile local --json --evidence-dir "$RUNNER_TEMP/ops-ci-evidence"
```

`--evidence-dir` 必须指向绝对目录。CLI 0.1.2 在唯一当次运行的内存 envelope 与已知 run 上执行导出，workflow 不创建、补写或重排证据文件。

workflow 不直接执行：

- `node --check`；
- `node --test`、Vitest、Playwright 或 canary runner；
- `tsc`；
- schema 校验器；
- lint、scan、build 或测试脚本。

workflow 直接保留 `ops` 命令的真实退出码，不使用 pipe/tee。标准输出只承载 CLI 的安全 envelope，供普通 job 日志查看，不作为 artifact 路径或资格输入。shell 在命令返回后把实际 `ops_exit` 写入本步骤的 `GITHUB_OUTPUT`，摘要记录同一数值；非零仍按原值退出。

成功与执行失败共享同一个导出边界。CLI 负责确认唯一当次 run，检查导出路径及逐级父目录，只导出普通、单硬链接且属于明确允许集合的文件。派单固定的允许集合为：

- `envelope.json`；
- `result.json`；
- `state.json`；
- `junit.xml`。

集合封闭为上述四名，没有附加 artifact manifest、原始 stdout 或动态扩展文件名。envelope/result各8MiB，state64KiB，JUnit1MiB；文件均须controller所有、0600、普通、nlink=1，父目录逐级锚定且拒绝链接。

成功运行必须有唯一当前run与四文件完整集合；缺件将原0变为非零。执行在预检阶段失败、尚未预留run时，只允许安全失败 `envelope.json`。源报告缺失或不安全时只复制经过边界的安全子集，gaps完整记录缺口，结论非零；不复制危险来源、不补造报告。历史run不参与发现，也不合并到当前run。

### 本次发布收据与always守卫

workflow仅为controller启用内部端口 `OPS_CI_EVIDENCE_PUBLICATION=github-actions-v1`，调用身份为 `github.run_id:github.run_attempt:github.job`，通过 `OPS_CI_EVIDENCE_INVOCATION`传入。这不是新公开CLI参数或第二质量入口；adapter环境白名单不包含这些键、`GITHUB_OUTPUT`或收据。

CLI只在**本次独占新建**目标、固定集合与全部文件最终回读成功后构造版本1收据。收据绑定调用身份、绝对目录、device/inode、唯一runId或null、最终exit、export状态、每个固定文件的字节数与SHA-256。decoded JSON上限4096字节，使用规范base64写入Runner私有step-output的固定键 `evidence_receipt`；不从磁盘JSON的exported声明构造资格。输出通道须为逐级安全父目录下的当前用户普通单链接空文件，不可被组或其他用户写；通过O_NOFOLLOW/O_NONBLOCK独占本步骤的首次写入并复核身份。

`rejected`、既存目标或链接目标均不产生收据。安全完成的 `exported` 与 `incomplete` 子集可以产生收据，但后者及成功缺run/缺件必须非零。发布通道错误也将原0转非零，原失败码保持；缺失/不完整收据不能因目录存在而获得资格。若原失败的完整收据已经到达，仍须与shell实际exit及全部IO复核一致才能保留安全失败证据。通道错误的stdout失败说明可不同于已留存的导出envelope；没有发布资格时该目录不进入Action。

后续 `Qualify this invocation's artifact IO` 在 `always()` 条件下处理实际尝试过的ops步骤或已有收据；未运行的ops步骤没有资格可消费。它使用已固定Node调用受审公共函数 `verifyEvidencePublication`，只做封闭artifact IO验证：核对收据来源通道、准确调用、shell实际exit、目录inode/owner/0700、逐级父目录、完整文件名集合、各文件的普通/nlink/0600/有界字节及摘要，以及envelope与收据一致性。成功exit必须完整四文件；无run必须非零且只有envelope。缺收据、额外文件、目录或内容漂移都使此步骤非零，不能输出ready。

该函数不运行ops、suite、schema解释器、测试、扫描或构建，不判断质量通过；它在所有句柄关闭后才允许步骤写出 `evidence_ready=true`。Action条件同时要求 `always()`、该核验步骤outcome为success、ready精确为true。没有 `ops_exit==0` 条件，故原失败的安全证据仍可上传；上传及核验成功均不会翻转此前失败。`if-no-files-found: error`仅作为获资格目录的最后缺件守卫，不能单独授予资格。

成功运行仍只能是 M1 候选：

```json
{
  "qualification": "m1",
  "partial": true,
  "eligible": false
}
```

job 名固定为 `ops-ci/bootstrap`。本 workflow 不产生、替代或冒充 `ops-ci/pr`、`ops-ci/release`，也不启用任何 required check。

## 6. 证据保留

经过上述 `always()` 资格守卫的上传步骤只消费：

```text
$RUNNER_TEMP/ops-ci-evidence
```

workflow不直接glob `.ops-ci/runs`，不读取原始stdout，也不把收据通道作为artifact。固定upload Action会跟随链接，因此仅允许CLI新建且公共IO核验通过的精确目录进入Action；存在、非空、JSON自称exported均不足以通过。

`result.json` 与父级 stdout envelope 应包含：

- 固定控制 commit SHA 与 dirty 状态；
- 控制源码摘要；
- CLI `0.1.2`；
- policy `m1.1` 与 SHA-256；
- registry schema/report 版本与 SHA-256；
- Runner label、Node、Docker、image manifest 与 image ID；
- selector、seed `1729`、suite 结果、计数、真实 exit 与时间；
- 隔离 inspect、canary 故障注入和 cleanup 证据。

artifact 不包含：

- run descriptor 或 nonce 私有 payload；
- 源码 snapshot；
- worker `/out` volume；
- adapter 或 holder 的原始 stdout/stderr；
- secrets、数据库内容或生产数据。

CLI失败且发布资格成立时，上传步骤仍运行，job保持失败。CLI未运行、目标既存/链接、导出rejected、收据或IO核验失败时，Action跳过；ops曾成功但缺收据时，IO核验失败令job非零。预检无run时只保留安全失败envelope。

收据不是数字签名，也不能使自改代码自证受信。其来源依赖经非作者复审并固定SHA的controller、Runner私有step-output通道及adapter不能写宿主路径。IO核验完成与Action打开目录是两个步骤，要求期间没有额外宿主写者；不声称能抵御拥有同UID或root的恶意宿主进程在最终核验后换链。新增步骤不执行不可信宿主代码，adapter无该目录或通道的挂载/权限；实际Runner通道权限、时序和artifact集合仍须bootstrap取证。

## 7. 后续隔离约束

workflow 只管理受信 host 环境并调用 `ops ci`。Docker socket 只由受信 controller 使用，adapter 不获得：

- Docker socket；
- 宿主 PID/network namespace；
- SSH agent 或云凭据；
- 应用控制目录；
- 共享开发数据库或现有运行栈。

worker 必须使用固定 digest、非 root、只读根、只读源码、独占输出、私有 tmpfs、`network=none`、cap-drop、no-new-privileges、资源限制和独立 cleanup deadline。真实行为必须由 `ops ci` 的 Engine canary 证明。

## 8. Review 与运行条件

运行前至少完成：

1. Ohm 对 CLI、证据导出、隔离后端和 manifest 完成修复；
2. 本 workflow 由独立 GPT 和 DS 系统 reviewer 复审最终输入；
3. Git agent 按显式路径冻结控制提交，记录准确 SHA；
4. 从该固定、干净 SHA push 到 `codex/integrated-development`，触发唯一 `ops-ci/bootstrap` 候选运行；
5. 产生真实 Engine、证据导出和 artifact 集合证据后才可判断 M1 bootstrap 是否通过。

任何 review 发现均应回到作者修复并形成新 manifest；修复后重新审查，不能沿用旧结论。

当前 workflow 修复没有运行 workflow、`ops ci`、语法检查、schema 或其他质量命令，也没有提交、推送或修改远端。实跑必须等待核心接口、两份独立 review 和固定 Git SHA 全部就绪。
