# 控制协议首个交接

日期：2026-11-15。任务：B-02/03/04、C-01 控制侧、C-02/03 引导、B-06 首次审查输入。状态：冻结接入协议，等待非作者静态审查；不代表 M1 已验收。

## 输入与范围

读取应用根 AGENTS、整体开发计划、运维入口、控制平面详细设计、CI 测试策略、CI 发布设计、DevOps 平台、发布信任链、生产 runbook、GitHub 环境配置、实施契约审查及 A-03 工具链结论。控制仓库输入 HEAD 为 `010588837dec2c9fa48aa19b6aadfd6d784a9746`；应用文档是已存在 dirty/untracked 工作树输入，不冒充固定源码。

仅写独立控制仓库；未改应用根、共享 schema/lockfile/root config、workflow 或远程；未提交、推送、连接生产，也未创建 agent。

## 交付文件

接入协议：[ci-protocol.md](../contracts/ci-protocol.md)。机器契约：`schema/ci-registry.schema.json`、`schema/ci-adapter-report.schema.json`、`schema/ci-protocol.d.ts`。控制资格与运行环境输入：`ci/policy.json`、`ci/runtime.json`。

已写部分候选实现保留：`lib/core.mjs`、`lib/config.mjs`、`lib/filesystem.mjs`、`lib/process.mjs`、`lib/state.mjs`、`lib/ci/registry.mjs`、`lib/ci/report.mjs`。它们不是完整 CLI；没有完成安装器、控制包验证、生产 doctor、隔离执行后端、完整编排、控制测试或发行包。请勿从文件存在推断能力已可用。首个交接的逐文件 SHA-256 与大小见同目录 `protocol-source-manifest.json`；清单自身摘要由交接消息给出，避免循环自引用。

协议已通过工具直接同步应用 CI agent Mencius（`01a1db36-b4d1-7b81-a017-f319e820857c`）。向祖先主 chat 的工具发送被工具拒绝；最终交接由本任务 final 返回主 agent。协议版本 `1`，CLI 目标 `0.1.0`，required policy `m1.1`。

## 首次信任与验证状态

没有运行测试、扫描、构建质量门禁、旧应用 ops 或独立 runner；没有正式通过报告。只读取文件、Git 状态与 HEAD、查询工具版本/可用性，并生成源码文件摘要以便审查。没有使用候选 CLI 自证可信。

本机 Node `24.16.0` 可用；Docker 等价隔离不可用。`ci/runtime.json` 的 `image: null` 明确表示尚无审核固定的镜像 digest，不能执行 suite，也不能把缺 Docker/镜像记为成功。工具准备和实际运行由主 agent 调度；不得使用生产或共享开发库作为 fixture。

后续顺序：非作者审查准确协议与候选源码/摘要 → Git agent 显式提交本控制仓库路径固定 SHA → 补齐入口和针对性反例并再次独立 review → 从固定 SHA 的 `ops ci` 编排 candidate canary/自测 → fix、复验、记录真实证据。由于当前入口尚未实现，本交接没有拟装作可执行的测试命令；后续应提交确切 `ops ci` selector、源码 SHA、镜像 digest 与报告清单后再运行。

全量资产登记、T0–T10、安全/覆盖率/性能、正式 required checks、控制发行/签名/安装和生产部署均未证明。M1 资格固定 partial/eligible=false。应用知识文档同步由后续文档 owner 完成，本任务不写应用文档。
