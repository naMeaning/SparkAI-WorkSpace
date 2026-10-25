# SparkAI UI 实施交接：gpt-6.1-sol / max

2026-10-24。此文件供用户发送给执行模型，本轮设计会话未自动执行它。

配套方案：[日夜基础主题与界面精简方案](SparkAI-UI-Design-2026-10-24.md)。主控及所有子 Agent 均使用 gpt-6.1-sol、max reasoning。不可用时说明，不擅自替换模型。

2026-10-25 归档：正式文档位于项目 docs/；[交互概念预览](../../artifacts/ui-themes-2026-10-24/sparkai-preview.html)及[文件说明](../../artifacts/ui-themes-2026-10-24/README.md)位于工作区 artifacts/。概念稿不作为产品验收证据，当前实施状态以 [Progress](../PROGRESS.md) 为准。

## 可直接复制的主控 prompt

~~~text
请开始实施 SparkAI WorkSpace 的“日间/夜间基础主题与界面精简”，使用 gpt-6.1-sol，reasoning effort=max。可以委派设计审查、主题代码、界面代码、独立审查/验证 Agent；不要只给建议或停在规划。

工作区：E:\003Projects\SparkAI-WorkSpace，产品 owner 为 sparkai_workspace。
设计文件：E:\003Projects\SparkAI-WorkSpace\sparkai_workspace\docs\SparkAI-UI-Design-2026-10-24.md
交接文件：同目录 SparkAI-UI-Handoff-2026-10-24.md。
预览与验证材料：E:\003Projects\SparkAI-WorkSpace\artifacts\ui-themes-2026-10-24。后续文档沿用项目 docs/，概念稿和验证材料沿用工作区 artifacts/ 或现有专项证据目录。

先恢复现场：检查 git status --short、branch、HEAD/upstream；读取根与桌面 AGENTS.md、GOAL 顶部、PROGRESS 当前快照、PRODUCT_INTENT、决策 ledger、CONTEXT_MAP 的主题首帧/窗口/Agent/设置/控件边界。交接基线为 main/134a9f40cf42d40176d083ce557f36171066d0b2，但以实查为准。已有上一轮设置设计的未提交文档和 artifacts，必须保留，不能 reset/checkout/清理或未经辨别整批提交。

本次最新优先级高于上一轮交接的 A/B/C 全量实施：只做下面 P1、P2。上一轮独立设置窗口、Main revision、多协议账号、自定义站点登录、更新发行源和新增 ComfyUI 平台工作保留为后续，不自动展开。接受实施时同批更新 GOAL/PROGRESS；纳入本轮设计材料时保留旧设计历史，地图只记录真实 owner/合同。

产品目标：像用户描述的 Codex 一样朴素、清晰、克制。日间与夜间共用布局、字号、交互，用实色中性背景、细分隔线、清晰焦点。每个任务区域一个实心主操作，常用次操作轻量显示，低频操作进所属区域菜单。保留单项目 Agent、单画布、既有成果与执行语义。

P1：基础主题与控件
1. 复用 light-classic/dark-classic ID、runtime/glass-theme-presets.json 真源，不建平行主题系统。新装默认建议 light-classic；明确保存的旧主题保持，旧 theme 字段按既有兼容迁移，不能一刀切覆盖。
2. 外观页默认日间/夜间；其他主题及玻璃/背景参数放“更多外观”，保留数据和恢复能力。此批不加定时切换或新的跟随系统字段。
3. 语义色采用设计表。普通主题无透明叠底、模糊、噪点、渐变和发光；图片/视频原色与 alpha 不变。14px 表单正文、15px 对话、12px 辅助；32–36px 控件高、16px 图标、6–10px 圆角，不缩字挤布局。
4. 打通 registry→Main normalize/defaults→Renderer projection→bootstrap/index 首帧→独立 Agent/native backgroundColor。覆盖主窗、登录/设置、菜单、图片参数、编辑/查看/创建表面，不能只改主画布。
5. 复用现有 ui 组件和 CSS owner。src/styles.css 保持 01→08 顺序、08 最后；修真实组件/投影，不堆 !important、filter 或末尾覆盖。
6. 完成相关专项、实际 Electron 截图和一批本地 EXE 交付后进入 P2。

P2：入口与配置收纳
1. 顶栏项目操作集中进项目菜单；保留领域文字/搜索/账户/系统操作。主题统一从设置访问；画布/专注/评审保留现有 ID，改为一处视图选择。
2. 左轨保留添加、成果、图层、需求、模板及底部设置。会话历史通过 Agent 会话名下拉。画布底部保留选择/平移/缩放/适配及“工具”，复用工具搜索、领域、最近使用，不默认铺五个插件按钮。
3. 单图上下文条默认“编辑、导出、更多”；其他动作进对应菜单，删除等保留原确认。多选复用原能力，不造第二个 selection owner。
4. Agent 标题保留会话名下拉/新建/更多/折叠；记忆、清理、位置、独立窗进更多。已完成步骤可折叠；运行/失败/问题不可隐藏，停止始终可访问，Main 确认前保留真实状态。
5. 输入区素材、图片设置、实心发送；直接生图降为明确文字动作，不与 Agent 发送混淆。Ctrl+Enter 固定发送 Agent，IME 保护、/goal 两阶段确认、/pause /resume /stop 语义不变。无选中不显示空上下文，素材角色/顺序/选中复用 canonical state。
6. 现有设置归为连接/生成/外观/扩展/更新，保留旧 section 深链接映射。本轮不依赖新的独立设置窗口。图片配置首屏模型摘要/比例/清晰度/数量；目录进“管理模型”，质量和服务专属项进高级。已启用池、默认模型、完整目录、能力验证、非默认高级值保留；无效参数错误可见。
7. 复用现有模型、ComfyUI、本地 Agent、视频配置 owner，仅调整呈现/入口。全局草稿仍保存/取消，图片配置仍即时保存并展示失败/重试；打开页面不新增网络探测。
8. 884×640 保持正式桌面布局，沿用 agent-panel-layout.ts 实际夹紧规则，不复制概念稿为聊天窄预览提供的纵向布局。

协作：主控最多同时带 3 个子 Agent。先由设计审查 Agent 固定动作去向表/状态矩阵；随后主题、界面 Agent 按互斥文件所有权工作。P2 在 P1 token 合同和交付稳定后合入；P1 中界面 Agent 可只读准备，不把 P2 偷混入 P1 包。主控拥有 main.tsx、settings-drawer.tsx、agent-window*、共享 ui 接口、公共设置/IPC、GOAL/PROGRESS/地图及最终集成。跨 owner 改动发建议，由 owner 执行。设计角色结束后释放槽位供只读审查，最后复用空闲槽位做 QA。不同 Agent 不同改一个 CSS 文件，不建多 Agent 专用框架。只有主控做最终打包/安装/commit/push。

验收必须有证据：同一项目的日夜对照、1280×800/884×640、空白/单选/多选/运行/错误、设置/菜单/图片参数/编辑/查看/独立 Agent；实际对比度、键盘焦点、点击/滚动/裁切；冷启动无闪变；切换不重挂画布或改选择/会话/任务；旧主题与玻璃参数可恢复；保存失败与移动入口可用。实际 DPI 与 CSS 模拟分别标注，不把模拟当真机。

从当前 package.json 选最小测试组合：P1 关注 test:glass-theme、test:settings-persistence、test:ui-foundation、aidebug:classic-themes；独立窗/生产变量变化补相关 agent-window 与 production-symbol-compaction。P2 选受影响 workspace/composer/settings 专项，一个 quick GUI 加一个覆盖改动的专项，不机械全量。公开动作/IPC/schema 若变，GUI/CLI/MCP/文档/automation 契约同步；纯入口搬迁不凭空扩 schema。检查现有测试覆盖，新增测试只验证真实迁移/状态/交互风险。

边界：使用隔离 profile、本地 fixture/loopback/fake；不发真实模型/图片/视频/Seedance/ComfyUI 服务请求，不安装新依赖/下载模型，不改 Extension/New API/生产。概念图不是产品截图，旧包不是本轮 EXE。

每批按站立授权执行 corepack pnpm run package:win:unrestricted。核对最终源码和 EXE 路径/大小/SHA-256。正常安全退出所有同名安装/开发实例，不强杀；未保存内容/活动任务阻止退出时保留并明确安装待执行。用品牌安装器 /S 原位升级，保留项目、设置、凭据、快捷方式，核对退出码、注册安装及已安装 EXE/ASAR。同步 Goal/Progress/地图，只提交本轮对应源码文档，普通 push 配置的 upstream 并核对远端 commit。EXE 上传、Release、tag 不在授权内。

P1、P2 按序完成后交付，分别报告实现、实际测试/截图、未验证项、EXE 身份、安装、文档与 push commit。失败要明确记录，不能用源码完成替代 EXE/安装，不能用静态搜索替代 UI 实测。不要自动开始上一轮后续范围。
~~~

## Agent 编排

| 角色 | 职责 | 权限/交付 |
| --- | --- | --- |
| 主控/集成 | 范围、依赖、数据流、冲突、验收与交付 | main.tsx、settings-drawer.tsx、agent-window*、共享 ui 接口、公共设置/IPC、文档；最终打包安装 push |
| 设计审查 | 当前组件与方案映射，逐个动作留/移/状态显示 | 只读，输出入口矩阵、状态矩阵、P1/P2 边界 |
| 主题代码 | registry、投影、fallback、基础 token、外观页、专项 | 获分配的主题文件；独立窗与公共接口建议交主控 |
| 界面代码 | workspace、canvas 工具、Agent/composer、图片配置 | 专属 TSX/局部 CSS；不编辑全局主题 owner |
| 独立审查/验证 | 迁移、请求边界、可访问性和真实证据 | 只读审查；测试脚本写入须主控分配；不自行修代码后宣告通过 |

这是五种职责，不要求五个 Agent 同时运行。最多主控+三个子 Agent。设计角色先结束；代码阶段释放槽位供审查；最后复用空闲槽位做验证。主控也可亲自承担设计或 QA。

逐文件分配：01-* / 07j-* 通常归主题 Agent；07e-* / 07g-* 与 canvas 局部样式归界面 Agent；04-settings-appearance.css、06-responsive.css、src/ui/* 和独立窗统一主控。分配变更必须通知，不能以“class 名相关”自行越界。

## 可单独发送的角色 prompt

### 设计审查

~~~text
你负责 SparkAI 本轮 UI 设计落地审查，使用 gpt-6.1-sol/max。读主控给出的最新方案、根/桌面 AGENTS 与当前源码。只读，不实施。
输出：①当前入口逐项映射到常驻/按选中或运行出现/局部菜单/设置；②两主题的 hover/focus/disabled/error 状态规范；③P1/P2 的 owner 与最小 UI 验收；④可能改变真实行为的风险。不要重复泛泛审美原则，不扩登录/更新/窗口架构，不把旧设计当已实现。
特别检查停止、发送/直接生图、素材选择、隐藏≠停用、旧主题兼容。给主控一份可冻结的清单后结束本轮角色。
~~~

### 主题代码

~~~text
你负责 P1 主题基础，使用 gpt-6.1-sol/max。只改主控分配的 registry、normalize/projection、bootstrap/index、Glass Lab 与主题 CSS/专项。沿用 light-classic/dark-classic 和单一 token；新装默认与旧数据迁移分开，其他主题可恢复。作品不得加滤镜。
不修改主控或界面 Agent 的文件；独立窗、Main 默认镜像和共享 ui 接口需要变化时给主控精确建议。不得堆末尾覆盖或改 import 顺序。做直接相关验证，报告实际命令/结果、未验证镜像和后续要求。不自行打包/安装/commit/push，不运行真实模型。
~~~

### 界面代码

~~~text
你负责 P2 入口与面板精简，使用 gpt-6.1-sol/max。按冻结动作矩阵，在获分配的 workspace-chrome、canvas toolbar、project-agent-panel/composer/image-config 和局部 CSS 实施。P1 交付前只做只读准备，不混入第一批包。
每个任务区域一个实心主操作；Agent 标题会话名/新建/更多/折叠；完成明细可折叠，运行/失败/问题/停止保持可见；素材/图片设置/发送和明确直接生图次操作。
保持 Ctrl+Enter、IME、canonical selection、TaskScope、/goal 确认及 callback 语义，隐藏工具不改变能力。主控拥有 main.tsx、settings-drawer.tsx、共享 ui、主题全局/响应式/独立窗，你给接线建议而不越界。不新增平行运行时或控件框架，不真实生成、不自行打包安装或 Git。输出改动、实际专项和待主控完成的路径。
~~~

### 独立代码审查

~~~text
你只读审查本轮最终 diff，使用 gpt-6.1-sol/max。依据当前源码和实际报告，不将作者自述当证据。
重点查：新装/旧迁移及首帧/独立窗漂移；CSS 对旧主题/媒体污染；display:none 丢能力；发送/直接生图或 Ctrl+Enter 路由改变；停止提前归 idle；selection/TaskScope 重建；目录/高级参数清空；草稿与即时保存混淆；隐藏变停用；菜单焦点/裁切/键盘；源码和包身份。
只报可定位的真实问题，给文件/行号、触发条件、影响、最小修复建议和优先级。区分缺证据与已证实缺陷。无发现也要说明未测试范围。作者修复后只复核相关变化，不直接修业务代码。
~~~

### 验证（复用空闲槽位）

~~~text
你验证本轮 SparkAI UI，使用 gpt-6.1-sol/max。核对当前源码/候选与报告，使用隔离 profile、本地样例图和 loopback/fake。不发真实模型/视频/ComfyUI 请求，不改真实用户配置/项目、不强杀应用。
练习两主题、两尺寸、主/独立 Agent、选中与运行/错误、配置保存/取消/失败、旧主题恢复、冷启动。检查可见尺寸、裁切、命中、焦点、状态/资产保持，不以 DOM 存在替代。报告截图/报告路径及实际通过/失败/未运行；DPI 模拟与真实测量分开。测试脚本改动须主控分配，最终打包/安装/Git 由主控执行，不并行启动安装器。
~~~

## 交接完成标准

主控收到各角色的最小摘要和证据路径后作最终判断。P1/P2 的源码、实际 UI、最终包、安装、文档、普通 push 分别有证据，才可描述完整交付；具体环境阻碍则写清未完成环节，不伪造完成或扩展到未授权远端工作。
