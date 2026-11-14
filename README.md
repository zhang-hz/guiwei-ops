# GUIWEI 控制平面

本仓库是 GUIWEI 公网生产控制平面的独立源码仓库，负责 `ops` 入口、required policy、复用 workflow、suite/report schema、发布验证器与宿主控制平面元数据。

应用源码仓库只负责业务应用、依赖、应用测试、fixture 和 suite registry；应用提交不得发布、替换或修改本仓库的控制包。控制 release 与应用 release 使用各自的分支保护、环境、权限、清单和版本。

本仓库当前只建立独立仓库边界。控制命令、工作流、控制 release、GitHub 环境保护与 required checks 必须按控制平面设计完成实现和负向验证后再启用。
