# 日夜基础主题与界面精简（2026-10-24）

状态：实施中；概念设计不作为产品验收。

## 接受合同

- P1：复用 light-classic / dark-classic 与 canonical registry，建立朴素日夜语义色、默认值/旧设置迁移/首帧/独立窗一致性；其他主题与玻璃/背景偏好可恢复。
- P2：P1 独立 EXE、安装与源码 push 后，收纳项目/视图/工具/单图/Agent 入口与五类设置，图片首屏模型/比例/清晰度/数量，高级值与完整模型目录保留。
- 不改变：唯一项目 Agent/画布/TaskScope/选择、真实运行状态、Ctrl+Enter/IME 和命令确认、Main 权威、全局草稿与图片即时保存合同。
- 不展开：独立设置 BrowserWindow/revision、登录/账号/更新协议、ComfyUI 平台新增能力、外部服务或正式发布。
- 交付：每批实际专项与隔离 Electron UI 证据、最终 Windows EXE 身份、安全正常退出与品牌原位安装、文档和普通 upstream push；0 真实模型或远程服务请求。

## 起点与保护

main / 134a9f40cf42d40176d083ce557f36171066d0b2，origin/main。已有五份 tracked 文档与两份设置设计、根 artifacts 保留；原 tracked 文档及 patch 在 `.diagnostics/ui-simplification-2026-10-24/baseline/`。本轮提交不夹带旧设计增量。

## P1 / P2 证据

### P1：主题与控件

- 实现：canonical 日夜语义色及新装 light-classic；明确旧主题与 legacy dark/light/system 映射保持，旧 localStorage fallback 与首个 React 帧一致；更多外观保留其他七主题及玻璃/背景偏好。独立 Agent/native 底色、focus allowlist 与安全首份外观同步；14px 表单 / 15px 对话 / 12px 辅助。移除 Agent 附件、参考图白膜/饱和度及成果 active-build 媒体入场调色；登录采用主题 backdrop、实色背景和安全滚动对齐。
- 专项：`test:glass-theme`（九主题×三材质/强调色/bootstrap，CJS38）、`test:settings-persistence`155（实际 Main→public DTO→Renderer 迁移）、`test:ui-foundation`、`test:agent-window`44/101、`test:production-symbol-compaction`、`typecheck` 通过。
- 真实 Electron：`.diagnostics/electron/glass-workspace-2026-10-25T03-35-03-610Z/report.json` ok，54受控场景/58截图；同项目日夜与1280×800/884×640，单选/多选、图片参数、参考图、编辑/查看/创建、菜单、假运行/错误、独立 Agent、两次冷启动和玻璃参数恢复。导入 hover 图标/键盘焦点、Dialog Tab/Esc、参考图无伪层均实际观测；登录884高实际滚动32px后末操作可见可命中。0模型请求/0应用console error。
- quick：`.diagnostics/electron/aidebug-2026-10-25T03-14-15-190Z/report.json` 六组/0失败，`shutdown.json` normal/graceful=true、forced=false。实际 token 对比度：日间正文15.52/辅助5.31/必要边界3.69/焦点6.58；夜间13.79/8.19/5.72/8.12。
- 生产 smoke：修正测试对首个 textarea 的错误假设（项目知识隐藏字段并非 Agent composer），以 `aria-label="Agent 指令"` 和真实surface ready定位；分页边界采用1px舍入容差，center命中仍必需。无网络 mock 下主题入口实际点击、生产独立 Agent 与账户/日志验证已通过，正常退出，无强杀；最终包的同专项将再次记录。
- 失败保留：早期旧主题selector未进入更多、旧preview滚动断言、登录硬编码blur及最小高度滚动均已区分测试适配与产品修复。一轮并行打包导致 Vite watcher 在 Windows installer obj 临时文件上 EBUSY、独立窗动态导入失败，证据 `.diagnostics/electron/glass-workspace-2026-10-25T03-32-31-524Z/`；随后改顺序复测全通过。原739源冻结与候选包审计保留，之后仅生产smoke脚本变更，最终重新冻结与打包。
- 最终制品：`release/local-deliveries/ui-p1-2026-10-25/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，110,549,504 B，SHA-256 `75e87f4d9356cb8c79cada89a7a751d1f422c762e64d083f8a78a40806e37f64`。最终739源 `740f7f33d4fcb598c35c2d5154dcd7e04188ac559b7023451ce0174879221532`，production package exit0，137 dist/199 owner逐字节包内审计通过。ASAR53,587,757 B，SHA-256 `f67b3b4ae563b5c41519ba160c25dc98b5f813a2b1efbf10ea2d6fccf555bed3`。初始候选及旧冻结另存，最终制品不会被P2同名包覆盖。
- 最终包实窗：`.diagnostics/release/packaged-smoke-2026-10-25T03-46-19-975Z/report.json` ok，生产主题入口实际点击、独立Agent、mock账户与日志/分页均通过，normal shutdown requested/graceful=true、forced=false。未把源码dev截图当生产包验证。
- 安装：`.diagnostics/ui-p1-delivery/install.json` ok，安装前所有同名实例0，品牌 `/S` 原位升级exit0/21,491ms；原注册目录 `E:\sparkai-workspace\naimage` /1.0.9保留，安装EXE与ASAR匹配候选，项目/设置/凭据metadata/快捷方式均保留。安装EXE SHA-256 `04be2d178219c99d4684ff8b684bbdaab803109dacc0aa9b766a0bfc0c79ebb9`。
- Git核验索引：本轮源码/文档精确暂存，既有旧设计差异留在工作树；对应commit、普通push及远端核验在 `.diagnostics/ui-p1-delivery/delivery.json` 写入。二进制与私有配置不入Git，无Release/tag/EXE上传。
- 限制：两尺寸采用真实窗口调整和 CDP viewport 投影，未验证125%/150%真实设备DPI；登录实测夜间，日间登录未单独截图；无真实模型/站点/ComfyUI、模型下载或正式发布。

### P2：入口与配置

等待 P1 最终 EXE、正常安装与源码 push 后执行。动作与状态矩阵如下；不能把本节方向当作已实现。

## 冻结动作与状态矩阵

2026-10-25 用户补充：P2 高频明确动作采用符号＋hover/focus 中文提示（如新建＋、移除垃圾桶）；沿用既有 IconActionButton 与 accessible name，最小命中 32px。菜单中的领域文字和危险确认、Agent 发送与直接生图区分保留。项目的新建/移除必须通过真实入口验证。

| 区域 | 常驻 | 收纳与保留合同 |
| --- | --- | --- |
| 顶栏 | 项目名/领域文字/搜索/账户/窗口 | 项目菜单保留新建/重命名/移除/导入导出；主题进设置；一处画布/专注/评审选择，ID 不变 |
| 素材轨/画布 | 添加/成果/图层/需求/模板/设置；选择/平移/缩放/适配/工具 | 会话历史进 Agent 会话名；领域与最近工具留在工具菜单，隐藏不等于停用 |
| 单图 | 编辑/导出/更多 | 原用途/关系/删除等进更多；原确认/多选 canonical command owner 不变 |
| Agent | 会话名下拉/新建/更多/折叠 | 记忆/清理/位置/独立窗进更多；折叠态运行也可停止；完成工具可折叠，运行/失败/问题保留 |
| 输入 | 素材/图片设置/实心发送 | 直接生图为文字动作；Ctrl+Enter 仍 Agent send，IME/命令确认不变；无选中无空上下文 |
| 设置 | 连接/生成/外观/扩展/更新 | 旧 section 映射保留具体目标；全局草稿保存/取消与图片即时保存失败重试分开；打开不新增网络探测 |

| 状态 | 日间 | 夜间 | 行为 |
| --- | --- | --- | --- |
| 正常/辅助 | #242424 / #666666 | #ECECEC / #B0B0B0 | 正文/辅助至少 4.5:1；实色表面 |
| hover/selected | #F0F0F0 / #E8E8E8 | #303030 / #343434 | 文字/图标保留，不依赖颜色单独标识选择 |
| focus/必要边界 | #5D5D5D / #858585 | #B7B7B7 / #999999 | ≥3:1，键盘可见，菜单 Esc 返回焦点 |
| disabled | 保留可辨文字与禁用语义 | 同左 | 不把隐藏代替禁用，不把进行中提前归 idle |
| error/运行/问题 | 真实语义色及文字图标 | 同左 | 不默认折叠；停止等待 Main 确认 |

P1 owner：主题 Agent 独占 registry/TS 投影/bootstrap/index/Glass Lab/01-* 与 07j-*；主控独占 Main 设置镜像、独立 Agent、04-settings-appearance/06-responsive、共享 ui 与集成文档。P2 owner 另行授权后实施，P1 包内不含入口重排。所有共享动作保留原 callback/schema；没有新 IPC/自动化动作。
