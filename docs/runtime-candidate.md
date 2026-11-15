# 控制平面运行时候选

状态：候选固定输入，等待非作者 review；不表示 `ci/runtime.json` 已更新、已受信或已通过执行验证。

取得时间：2026-11-15T02:36:48+08:00（2026-11-14T18:36:48Z）。

## 1. 候选值

正式 Runner 固定为 GitHub 托管 `ubuntu-24.04`，即 Linux x86_64。控制 CLI 使用 Node.js `24.16.0`，运行代码不依赖 npm 包。

建议由 core owner 审查后写入 `ci/runtime.json` 的值：

```json
{
  "nodeVersion": "v24.16.0",
  "image": "docker.io/library/node@sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f"
}
```

该 `image` 使用 linux/amd64 平台 manifest digest。它不是多架构 index digest，不能用于 arm64 等其它平台。

## 2. Node.js 官方运行归档

| 项目 | 值 |
|---|---|
| 发布版本 | `v24.16.0` |
| 归档 | `node-v24.16.0-linux-x64.tar.xz` |
| 官方地址 | https://nodejs.org/dist/v24.16.0/node-v24.16.0-linux-x64.tar.xz |
| 文件大小 | `31,428,548` bytes |
| SHA-256 | `d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9` |

验证过程：

1. 从 Node.js 官方发布源下载 linux-x64 归档；
2. 从同一版本目录取得 `SHASUMS256.txt`，对应行声明的摘要与上述值一致；
3. 对下载归档重新计算 SHA-256，结果与声明值一致；
4. `SHASUMS256.txt` 的 SHA-256 为 `e20ebbf68d33f42d196a7a11b8a91d422fa37b759c0a51aa4857977135cc5e95`；
5. `SHASUMS256.txt.sig` 的 SHA-256 为 `cc94428d80ae6770e1bc4c36dd22e957910fc135cc33926c01ad504206a05d0d`。

签名验证来源：

| 项目 | 值 |
|---|---|
| checksum | https://nodejs.org/dist/v24.16.0/SHASUMS256.txt |
| 分离签名 | https://nodejs.org/dist/v24.16.0/SHASUMS256.txt.sig |
| 官方公钥仓库 commit | `481637f813e912c4aa3622d7964ab426c97b8e8d` |
| 公钥指纹 | `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356` |
| 签名 Key ID | `20B1A390B168D356` |
| 公钥文件 SHA-256 | `5115095e2f8010c75da052ecb1cfb3af630e084f0f8daa93a863557b01b0f90a` |
| 公钥固定地址 | https://raw.githubusercontent.com/nodejs/release-keys/481637f813e912c4aa3622d7964ab426c97b8e8d/keys/5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc |

在一次性、空的 GPG keyring 中导入上述固定公钥后，`gpg --verify` 返回：

```text
GOODSIG 20B1A390B168D356 Antoine du Hamel <antoine.duhamel@platformatic.dev>
VALIDSIG 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356
TRUST_UNDEFINED
```

`TRUST_UNDEFINED` 表示临时 keyring 没有本地信任路径配置；它不是坏签名。签名的密码学校验通过，公钥身份由官方 `nodejs/release-keys` 仓库的固定 commit 提供。

## 3. Node.js 官方容器镜像

发现时使用的 tag：

```text
library/node:24.16.0-bookworm-slim
```

tag 只用于发现。执行时应使用下列不可变 digest，不能依赖浮动 tag。

| 层级 | Digest | 含义 |
|---|---|---|
| 多架构 image index | `sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203` | Docker Registry 返回的 OCI image index；同时覆盖多个平台，不直接作为本 Runner 的平台锁定值 |
| linux/amd64 manifest | `sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f` | Ubuntu 24.04 x86_64 Runner 的候选固定值 |
| linux/amd64 config | `sha256:d9e872c3ee59358dc71c3c99957c2d8ccd3f21419fee87b742faddcf00a6ecee` | 容器配置与镜像层身份；可由 `docker image inspect` 的镜像 ID 核对 |

Registry 证据：

- image：`docker.io/library/node`
- manifest 读取端点：`https://registry-1.docker.io/v2/library/node/manifests/24.16.0-bookworm-slim`
- index `Content-Type`：`application/vnd.oci.image.index.v1+json`
- linux/amd64 manifest `Content-Type`：`application/vnd.oci.image.manifest.v1+json`
- index HTTP 状态：`200`
- platform manifest 与 config blob 的实际内容重新计算 SHA-256 后均与声明 digest 一致

linux/amd64 config 回读：

| 字段 | 值 |
|---|---|
| `os` | `linux` |
| `architecture` | `amd64` |
| `created` | `2026-06-11T00:47:06.137921688Z` |
| `NODE_VERSION` | `24.16.0` |
| config blob 大小 | `6,826` bytes |

镜像只被 Registry API 读取；本机没有 Docker，因此没有拉取或启动镜像，也没有把它记为可运行验证。

## 4. 官方 Workflow Action

后续 bootstrap workflow 的 checkout 候选固定到：

```text
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
```

| 项目 | 值 |
|---|---|
| 官方发布 | `v7.0.1` |
| release | https://github.com/actions/checkout/releases/tag/v7.0.1 |
| commit | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| 发布时间 | `2026-07-20T15:10:05Z` |
| GitHub commit verification | `verified=true`，`reason=valid` |
| tag 目标 | `refs/tags/v7.0.1` 指向同一 commit |

workflow 必须使用完整 commit SHA，并设置 `persist-credentials: false`。

## 5. 开发 Linux 可用性观察

作为候选 runtime 之外的后续测试环境线索，2026-11-15T02:40:38+08:00（2026-11-14T18:40:38Z）以 `BatchMode=yes`、`StrictHostKeyChecking=yes` 对开发机 `srvdev` 做了一次只读 SSH 探测。没有读取 secrets、连接 PostgreSQL、创建容器/网络/目录或修改主机。

| 项目 | 观察值 |
|---|---|
| 主机 | `srvdev` |
| 系统 | Ubuntu 26.04.1 LTS |
| 架构 | `x86_64` |
| Node.js | `v24.22.2` |
| Docker client/server | `29.7.2` |
| Docker Compose | `5.5.0` |
| CPU | 4 |
| 内存 | `7,784,603,648` bytes，约 7.25 GiB |
| 根文件系统 | 总计 `83,952,558,080` bytes；可用 `33,892,347,904` bytes；使用率 58% |
| Docker root | `/var/lib/docker` |
| Docker storage driver | `overlayfs` |
| Docker security options | AppArmor、seccomp `builtin`、cgroup namespace |
| Docker 容器计数 | 6 个运行中、0 个暂停、0 个停止 |

这只证明开发 Linux 具有可用的 Docker daemon 和 Node，不等于验证了临时隔离容器。宿主 Node `v24.22.2` 不符合候选 `v24.16.0`，后续候选测试不得使用它冒充固定 runtime；应使用本页固定归档或镜像 digest。开发机已有 6 个运行中容器，后续工作必须创建独立的当次 run 网络、临时目录和容器，且不得触碰持久运行栈或 `guiwei-dev-pgdata`。

正式 PR/release 仍必须在干净的 GitHub 托管 `ubuntu-24.04` Runner 上执行；开发 Linux 只能帮助完成不依赖 Docker 的开发环境验证。

## 6. 待 core owner 接入

本文件只交候选值。`ci/runtime.json`、`lib/`、`policy` 与 `schema/` 属于 core owner，当前未修改。

接入前仍需：

1. core owner 将 linux/amd64 manifest digest 写入 `ci/runtime.json.image`；
2. 控制 CLI 提供唯一的 `ops ci` bootstrap 资格入口及精确参数；
3. 隔离后端证明容器以非 root、只读根文件系统、`network=none`、cap-drop、无宿主 socket/凭据挂载和受限资源运行；
4. cleanup 独立确认容器、进程与临时目录均已回收；
5. 在固定控制 SHA 上经 `ops ci` 生成真实正反例证据并经非作者 review。

在此之前：

- 不创建 required check；
- 不使用 tag 代替 digest；
- 不用 `echo`、空跑或独立 runner 伪造通过；
- 不把本候选值表述为已受信 runtime。
