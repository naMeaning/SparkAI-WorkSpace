# SparkAI WorkSpace 正式发布清单

本文固定 Windows 正式版本的最小发布顺序。日常功能开发只运行受影响领域的最小验证；以下完整流程只用于候选版本收口和正式发布。

## 1. 冻结前更新

1. 确认 `package.json` 版本、最低升级版本与 runtime compatibility。
2. 更新 `scripts/release/release-notes.json` 中的用户可见变更。
3. 新建或更新 `docs/RELEASE_<version>.md`，记录能力、架构影响、升级边界与已知限制。
4. 更新 `docs/README.md` 和 `docs/CONTEXT_MAP.md`；若登录、授权、模型 Relay、更新或部署合同变化，同时更新根目录 `WORKSPACE_CONTEXT_MAP.md`。
5. 检查工作树，只提交本版本源码与文档，不加入本地 SDK、临时目录、密钥、用户配置或诊断制品。
6. 提交并推送冻结源码。正式构建期间不得再修改工作树。

文档必须在构建前完成。`release:final` 会记录 HEAD 和工作树指纹；打包后再补 Markdown 同样会使制品与源码失配并要求重新构建。

## 2. 正式验证

运行：

```powershell
corepack pnpm run release:final
```

编排顺序为：

```text
97 项 release:verify
→ Windows NSIS 打包与品牌 UI
→ packaged smoke
→ 隔离安装/重装/卸载 smoke
→ updater 与 helper 自测
→ 签名 manifest / Restart ASAR
→ 上一版本到当前版本的重启更新 E2E
→ Setup、ASAR、manifest、sidecar 与 SHA256SUMS 交叉校验
```

只有同一次 `release:final` 完整成功、`release/.naimage-release-incomplete.json` 被编排器清除且源码指纹前后一致，制品才可发布。单独补跑某一 smoke 可用于诊断，但不能替代完整正式编排。

## 3. GitHub Release

1. 确认远端 `main` 包含构建使用的冻结提交。
2. 创建与 `package.json` 一致的 `v<version>` tag 和 GitHub Release。
3. 上传正式编排生成的 Setup、Restart ASAR、签名 manifest、sidecar 与校验文件；不上传私钥、用户配置或 incomplete marker。
4. 重新读取 Release 资产列表，核对名称、大小和数量。
5. 对私有仓库明确记录：客户端更新不能内置 GitHub Token；生产更新应使用 SparkAPI 的受控下载/manifest 服务，GitHub Release 只作为受权限保护的发布存档。

## 4. 耗时基线与安全续跑

当前正式发布通常需要约 25–40 分钟：97 项门禁（含多组真实 Electron GUI 与产品性能验证）通常占主要时间，Windows 打包约 2 分钟，安装/卸载约 1–2 分钟，更新、签名与哈希复核还需数分钟。机器负载、杀毒软件、NSIS 首次启动和 Electron 冷启动可能进一步增加耗时。

日常开发不得机械执行该流程。`release:verify` 支持从失败门禁安全续跑，但必须同时提供上一份 `.diagnostics/release/.../report.json`、失败门禁名和本次明确允许变化的仓库相对路径。例如：

```powershell
$env:NAIMAGE_RELEASE_VERIFY_RESUME_REPORT = "<previous-report.json>"
$env:NAIMAGE_RELEASE_VERIFY_RESUME_FROM = "requirement GUI"
$env:NAIMAGE_RELEASE_VERIFY_RESUME_ALLOW_CHANGED = "naimage-studio/scripts/aidebug-requirement-node-suite.mjs"
corepack pnpm run release:final
```

续跑器会确认旧报告源码指纹前后一致、旧 HEAD 是当前 HEAD 的祖先、失败点之前每项均通过，并拒绝任何未显式列入 allowlist 的代码变化。它会在新报告中保留复用来源、旧 HEAD、变更路径和复用门禁数；从失败项开始的所有后续步骤仍会真实运行。依赖锁、产品代码、构建工具或发布产物规则变化时不得列入窄 allowlist，应从头验证。不能只凭目录里存在旧安装包跳过门禁。
