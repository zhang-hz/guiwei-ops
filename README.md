# GUIWEI 控制平面

本仓库是 GUIWEI 公网生产控制平面的独立源码仓库，负责 `ops` 入口、required policy、复用 workflow、suite/report schema、发布验证器与宿主控制平面元数据。

应用源码仓库只负责业务应用、依赖、应用测试、fixture 和 suite registry；应用提交不得发布、替换或修改本仓库的控制包。控制 release 与应用 release 使用各自的分支保护、环境、权限、清单和版本。

本仓库提供 CLI `0.1.1` 的 `ops ci` 候选实现：参数与依赖选择、required 对账、只读源码快照、Linux 本地 Docker 调度、父级报告与独立回收。registry/report/result schema 为 `1`；policy 为 `m1.1`。执行结果始终标记 `qualification=m1`、`partial=true`、`eligible=false`、`trustStatus=candidate`。已编码不表示已验收或入口已受信。

控制运行代码只使用 Node.js `24.16.0` 的内置模块，无 npm 运行依赖。Linux 包入口为 `bin/ops`，Windows 为 `bin/ops.ps1`；wrapper 只透传参数数组。正式发行的离线 Node 包装、签名与受审安装尚未提供。

运行方式（仅在非作者审查准确源码、Git agent 固定 SHA 后由指定 bootstrap 执行）：

```sh
# 当前目录是固定、干净的控制仓库：执行两个控制必需suite
sh ./bin/ops ci --profile local --json

# 定向canary仍会补齐control-unit的完整依赖文件集
sh ./bin/ops ci --profile fast --suite control-canary --json

# 只生成经语义校验的计划，不执行测试
sh ./bin/ops ci --profile local --file tests/ci/canary.mjs --file tests/ci/protocol.test.mjs --explain --json
```

从应用仓库根调用固定控制包的绝对 `bin/ops` 路径，加载应用 `tools/ci/suite-registry.json` 和应用 required 集合。应用测试与 fixture 不复制到控制仓库。正式执行还要求 Linux amd64、Ubuntu 24.04、本地受信 Docker Engine、预装 [固定镜像与配置身份](ci/runtime.json)；入口不会拉取浮动镜像或退回宿主 runner。Windows 可以承载开发与计划解析，执行隔离 suite 明确失败。

报告位于当前工作区 `.ops-ci/runs/<runId>/result.json`、`junit.xml`；原始 stdout/stderr 仅保留字节数与摘要。已有 runId 不可覆盖。`control-unit` 运行无 Engine 的隔离自测；`control-canary` 由固定父级 handler 调度真实容器故障注入与 Engine 回收复核，adapter 不获得 socket。详见 [跨仓库协议](docs/contracts/ci-protocol.md) 与 [实现交接](docs/progress/cli-handoff.md)。

所有测试、语法检查、schema 断言、扫描和构建门禁只能由 `ops ci` suite 编排；候选入口受信前不直接启动内部 adapter、Node runner 或扫描器。此源码交接没有任何真实 `ops ci` 执行证据，须先完成独立静态审查与固定提交引导。

`bootstrap`、`doctor`、生产配置/secret 接线、control/application promote、签名验证、部署、备份恢复和完整 T0–T10 资格均不在本切片内，对应公开命令显式拒绝。生产旧应用脚本不是可信入口，不能用于补验证；生产、共享开发数据库与凭据均不进入 CI。
