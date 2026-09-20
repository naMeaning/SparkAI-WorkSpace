# SparkAI WorkSpace 1.0.9 发布说明

版本日期：2026-08-16  
文档记录的测试快照：2026-09-15，源码标注为 `d88fae2`；当前工作区是无 `.git` 元数据的文件快照，不能仅凭本文件证明该提交或制品仍可复现。

发布命名决策（2026-09-20）：GitHub Release/发布项目展示名使用 `SparkAI-WorkSpace`；应用内展示名继续使用代码中的 `SparkAI WorkSpace`，`naimage-studio` 更新 product、App ID、协议、CLI、数据目录和 Restart ASAR 兼容前缀不变。

1.0.9 将产品名称统一为 SparkAI WorkSpace，并在保留既有 EXE、App ID、项目格式、CLI 和本地数据兼容的前提下，完成四工作台、项目数据边界、模型接入、图片交付、批量性能和 Windows 使用体验的集中升级。右侧项目 Agent 仍是唯一执行中心，通用、电商、社媒和科研工作台继续共享同一个项目、画布、Session、资产与 Agent Runtime。

当前开发快照相对 2026-08-16 冻结说明新增：

- 生图默认走官方 OpenAI 兼容 Images API，不再把 SparkAI `/v1/image-tasks` 或对话模型 Responses 生图当作默认协议。
- 画布选中图片/图片容器即当前素材，可改序号和原图/参考角色；图片容器支持一键重新生图，不经过 Agent。
- 缩略图按内容哈希缓存，模型目录 TTL 15 分钟。
- 当前测试安装包见 [安装说明](./INSTALLATION.md)。这不是正式 `release:final` 候选。

## 本次更新

- 新建项目必须由用户选择目录，项目 Session、受管图片、视频、Agent FastMemory、会话状态和导出结果均保存在项目目录内；不再为新安装创建 AppData 默认项目或全局画布 Session。
- 新增旧 AppData 数据迁移流程，包含来源预检、目标空间检查、逐文件 SHA-256、staging、原子发布、项目索引回滚和独立的源数据清理确认；另提供默认只读的迁移验收报告工具。
- 新增统一导出中心，集中管理图片、图片组与 PSD 导出，并提供预检、格式、命名模板、项目级预设、冲突策略、串行队列、内容指纹增量跳过和项目级历史记录。
- 图片组名称直接映射为 `<project>/image-groups/<图片组名>/`；一次选择多个图片组会生成多个同级文件夹，并通过整批 staging、备份和回滚避免部分发布。
- 图片冷缩略图改为最多 2 个常驻 Sharp Worker，磁盘缓存提高到 512 个变体和 512 MiB；画布大图优先使用 1024 缩略图，最终查看器继续读取受管原图。
- 顶部 Agent 对话框的比例和清晰度会冻结到当前任务，覆盖模型提交的冲突参数，并同时写入结构化请求和上游 Prompt 交付规格；成果保留原始可编辑 Prompt。
- 每张生成图保存白名单请求参数、上游实际响应参数、耗时和成图实测尺寸；成果标题改为本地内容摘要，不再直接复制完整 Prompt，也不会额外调用模型。
- 账号登录可直接进入工作区，自定义 Base URL 需要有效 Pro License；账号模式继续完整保留每个模型单独配置自定义 API Key 的能力，密钥使用 Windows 安全存储。
- 纯文生图支持通过独立 SparkAI Extension 创建异步图片任务并轮询短请求，避免 Cloudflare 长连接超时；原生 New API 继续独立升级，编辑、参考图和第三方同步接口保持兼容。
- Agent 对话正文恢复原生文本选择和 `Ctrl+C`，不增加逐消息复制按钮；图片容器支持多选整体移动，连接头取消路径不再破坏关系，并可对具体连线精确断开。
- 图片查看器和成果编辑器支持更稳定的连续切图、双缓冲、双向尺寸调整和全屏显示；生成参数字号、参考图控件和窄窗口布局同步提高可读性。
- 安装引导、工作区、设置和业务对话框统一为透明玻璃视觉，并补充快速开始、帮助、隐私、协议、费用与关于页面。

## 升级与兼容

- 支持 Windows 10/11 x64。
- 产品展示名为 SparkAI WorkSpace，主程序为 `SparkAIWorkSpace.exe`。App ID、协议、CLI、项目格式和用户数据目录保持兼容，以支持从旧版原地升级。
- 更新产品仍为 `naimage-studio`，runtime compatibility 保持 `windows-x64-electron-42-runtime-3`，最低受支持更新版本保持 `1.0.5`。
- 普通图片继续写入项目 `exports/images/`，PSD 写入 `exports/psd/`，图片组新写入项目 `image-groups/`；旧 `exports/image-groups/` 仅用于打开历史导出。
- Base URL、用户 API Key、账号 Cookie 和上游签名 URL 不会写入项目 Session、导出历史或迁移报告。

## 发布边界

- 正式候选必须由同一次 `corepack pnpm run release:final` 完整生成，并通过 113 项验证、Bundle 硬门禁、产品性能、打包后 smoke、安装/重装/卸载、更新 helper、签名 manifest、1.0.8 到 1.0.9 更新 E2E 和最终 SHA-256 交叉校验。生成目录中的正式报告是发布状态的唯一证据，本文件不替代该报告。
- SparkAI Extension 的真实 Docker 内网、Caddy、Cloudflare 和原生 New API 生产联调由部署方执行，本地桌面候选不能证明线上 3-5 分钟图片任务已经通过。
- 本版本没有用真实付费图片或视频上游验证各 provider 对比例、清晰度和 Seedance 协议的实际服从度；仓内验收工具默认 dry-run，真实请求需要多重显式授权。
- 旧 AppData 的只读清单和模拟迁移合同已经覆盖，但真实用户数据仍应先备份，再由用户显式执行迁移和单独清理确认。
- Windows 安装包没有商业 Authenticode 证书时可能显示未知发布者；仍应使用同次正式编排生成的 Ed25519 签名 manifest 和 SHA-256 校验文件确认完整性。

本版本的本地正式编排不会调用真实图片、视频或 Seedance 服务，也不会自动迁移或删除真实用户数据。
