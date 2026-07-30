# naimage 1.0.7 发布说明

版本日期：2026-07-30

1.0.7 将 1.0.6 之后的画布协作、Agent 运行控制、批量生成保护、跨境电商工作流和 Liquid Glass 工作区正式合并为一个可发布版本。右侧项目 Agent 仍是唯一执行控制中心，左侧素材栏和多视图只提供真实项目导航与成果检查。

## 本次更新

- 新增六套 Liquid Glass 主题、Clear/Frosted/Dense 三种材质和九类实时参数；设置可持久化，非默认外观冷启动不会跳回默认主题。
- 新增正式左侧素材栏，成果、图层、需求、历史、导入和设置全部接入真实项目状态；Workbench、Focus、Review 共用同一 canonical canvas。
- 新增画布 Goal 模式。执行前冻结任务范围并要求确认，高并发先做小批量探测，再按 2、4、配置上限渐进放量；探测或集中失败会停止并熔断。
- Agent 支持暂停、恢复、真实停止和运行中 steer；SOURCE 与 REFERENCE 可独立 keep、replace、merge 或 clear，GUI、独立窗口和 CLI 共用同一协议。
- 项目会话升级为 v5 mutation journal，加入 writer checkpoint、字段级 mutation clock、delete/restore barrier、tombstone 和 30 天安全 GC，覆盖真实双 Renderer 冲突。
- 新增 PNG/JPEG/WebP 输入识别以及 PNG/JPEG/WebP/AVIF/TIFF 本地导出；转换不调用模型。远程图片经 Main 受管下载、逐跳公网校验、DNS pin 和并发限制后才进入项目。
- 新增跨境电商套图与多语言配置、逐图/逐语言 Prompt、Requirement/Skill 保存和复用，并加入 Project Graph 导入与 Graph CLI 原子操作。
- 自动化命令 schema 统一驱动 Renderer、CLI 参考和测试，新增功能同步进入 naimage CLI/Skill。

## 升级与兼容

- 支持 Windows 10/11 x64。
- `1.0.6` 可使用签名 Restart ASAR 无损升级到 `1.0.7`；更低版本遵循 `minimum_version` 和完整安装器策略。
- 项目、会话、FastMemory、设置和图片库继续保存在当前用户数据目录；安装、更新和默认卸载不会删除创作数据。
- 更新产品身份仍为 `naimage-studio`，runtime compatibility 保持 `windows-x64-electron-42-runtime-3`。

## 发布与校验

- 私有 GitHub Release：[naimage 1.0.7](https://github.com/naMeaning/naimage/releases/tag/v1.0.7)
- 正式资产包括 Setup EXE、Restart ASAR、签名 `desktop-release.json`、安装包 sidecar 和 `SHA256SUMS.txt`。
- 安装包当前没有商业 Authenticode 证书，Windows 可能显示未知发布者；应以同一 Release 中的 SHA-256 和 Ed25519 签名 manifest 校验完整性。
- 客户端不会内置 GitHub Token。生产更新继续通过 SparkAPI 的受控下载与 manifest 服务，私有 GitHub Release 只作为发布存档。

本版本使用仓库唯一正式入口 `pnpm run release:final` 生成和验证制品，并以官方 1.0.6 运行时执行隔离 Restart 更新 E2E。发布过程不调用真实图片生成服务。
