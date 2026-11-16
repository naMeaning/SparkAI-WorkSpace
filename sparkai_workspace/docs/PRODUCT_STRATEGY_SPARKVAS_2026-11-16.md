# Sparkvas 产品决策包

**日期**：2026-11-16

**性质**：已确认的产品方向与设计决策；本文件不是功能已完成证明。
**目标**：把现有 SparkAI WorkSpace 重新定义为 Sparkvas，一个画布优先、AI-native 的视觉创作工作台，并围绕电商美妆与影视剧建立可复用的创作配方生态。

## 1. 决策摘要

Sparkvas 的主界面仍是项目画布。用户从画布选中图片、图片组或视频成果后，可以直接附加一个 Skill，例如“把这个商品做成跨境美妆套图”或“把这张图扩展成分镜”；系统会创建一次可追溯的 Recipe Run。用户可以在 Studio 中查看、编辑、审阅和运行 AI 起草的 Recipe，结果回到同一项目画布。

AI 是 Recipe 的第一作者，负责根据目标起草工作流、补齐步骤、解释依赖、修复失败并提出运行计划；用户在关键节点审阅、修改、锁定或授权执行。产品不把 AI 隐藏成不可解释的一键魔法，也不要求用户先学习底层节点图。

产品保留三层扩展模型：Skill 是不执行代码的声明式创作技法；Tool 是拥有明确权限的可执行适配器；Recipe 是由 Skill 与 Tool 组成、可以版本化和复用的创作配方。Marketplace 通过 GitHub 仓库和约定 topic 发现包，服务端校验后生成 Registry，客户端从 Registry 安装和更新。本期所有内容免费，不引入支付、退款或 DRM。

## 2. 要解决的问题

当前产品已经拥有项目 Agent、无限画布、图片成果、需求节点、来源关系、图片任务恢复、多个领域投影、ComfyUI 和 CLI/MCP 合同，但产品叙事仍分裂：

- 画布能保存成果，却没有一个用户能理解的“从目标到结果”的可编辑方法层。
- Agent 能执行图片任务，但 AI 如何规划、为何选择某种步骤、失败后如何修复，仍不够可见。
- Skill、ComfyUI、图片/视频模型和本地工具之间没有统一的可安装、可复用、可审阅包装。
- “画布 + Agent + MCP”已经被 Krea、Canva AI、FLORA、Adobe Firefly Boards 和即梦等产品覆盖，不能作为独立卖点。
- 当前代码与历史产品意图明确排斥工作流编辑器；本次方向需要显式替换该边界，不能在旧模型上偷偷堆功能。

Sparkvas 的核心问题定义是：**普通创作者知道想要什么，但不想学习复杂节点；专业创作者知道方法，却缺少可复用、可解释、可迁移的创作配方。**

## 3. 目标用户与场景

用户优先级为：

1. **电商创作者与小团队**：需要商品图、场景图、模特图、跨境多语言、多尺寸、多平台交付和批量复用。
2. **专业设计师与工作室**：需要保留素材主权、锁定版本、比较方案、复用方法和审计来源。
3. **社媒创作者**：需要从一个主题快速生成图文和短视频变体。
4. **泛普通用户**：使用免费入口和已有 Recipe，不承担复杂配置学习成本。

影视剧不新增第五个工作台，先作为 Film Skills/Recipes 进入 `general`。它覆盖两类场景：

- **前期分镜与预演**：剧本/镜头意图 → 景别、焦段、机位、构图、光线、镜头动作 → 分镜表与关键帧。
- **短剧批量生产**：角色与场景一致性 → 多镜头图像 → 竖屏短视频/镜头变体。

电商和影视共享一套语义：场景、主体、镜头、光线、动作、参考素材、连续性和输出槽位。差异放在 Recipe 与 Skill 包中，不复制两套运行时。

## 4. 领域模型

### Canvas

Canvas 是 Project 的主创作面和事实入口，承载图片、视频、图片容器、Requirement、Recipe Run 结果和 provenance。它不负责展示所有底层执行节点。

### Studio

Studio 是同一 Project 内的第二创作面，用于查看和编辑 Recipe 图。它共享 Project、selection、TaskScope、资产、会话、权限和执行回执；关闭 Studio 不会丢失画布状态，也不会创建第二个 Agent。

推荐的语义节点为：`Input`、`Brief`、`Skill`、`Transform`、`Tool`、`Review`、`Output`。节点表达创作意图和交付关系，不复制 ComfyUI 的每一个底层算子。底层模型参数在节点详情中可展开，默认保持简洁。

### Requirement 与 Recipe

Requirement 保留为画布内的轻量单步自然语言要求，适合“把背景换成白色”这类快速操作。Recipe 是多步、可版本化、可分享的创作方法，可以包含 Requirement。用户从画布调用 Skill 时默认创建 Recipe Run；运行成功后可选择“另存为 Recipe”，避免每次轻操作都污染公共配方库。

### Recipe Run

Recipe Run 是一次冻结的执行实例，记录输入资产、Recipe 版本、Skill/Tool 版本、模型与参数、权限确认、步骤状态、输出资产和错误。重复运行使用新的 Run 身份，不能覆盖旧成果；未知提交、断线和重启沿原 Run 恢复，不自动重发不明的付费请求。

### Skill

Skill 是声明式创作技法，包含：名称、说明、输入要求、提示词片段、参数默认值、示例、限制和适用场景。摄影与导演技法可以作为 Skill 发布，例如三分法构图、景别规划、推拉摇移、连续性检查、商品材质表现和跨境文案变体。Skill 不执行任意代码，也不能自行读取用户私有目录或发起网络请求。

### Tool

Tool 是可执行适配器，例如图片模型、视频模型、ComfyUI、Python/R 受管 Runner 或 MCP 服务。Tool manifest 必须声明能力、输入输出、网络范围、文件范围、进程权限、所需模型、许可证和兼容版本。Tool 的安装和首次运行需要显式授权；权限改变、版本改变或来源改变时重新确认。

### Recipe

Recipe 是可版本化的工作流包，引用固定版本的 Skill 与 Tool，声明输入槽位、输出契约、依赖、示例、适用领域、许可证和兼容的 Sparkvas 版本。Recipe 可以由 AI 起草，也可以由用户编辑；分享时保留来源和版本，不把用户的私有素材或 Key 打包进去。

## 5. AI-native 交互

用户在画布选中一张美妆商品图，输入“做一套跨境电商香水图并给我一个 5 秒短视频镜头”，或者点选一个 Skill。Agent 先生成 Recipe 草稿：输入商品、检查主体、生成场景图、生成语言/尺寸变体、生成视频镜头、输出交付包。Studio 展示每一步的目的、输入、输出、依赖和权限。

用户可以：

- 修改节点名称、顺序、提示、参数、模型或输出槽位；
- 让 Agent 解释“为什么需要这一步”、自动修复缺少的依赖或根据错误重写步骤；
- 锁定品牌规则、商品主体或角色外观，防止后续步骤漂移；
- 只运行选中的分支，先预览影响范围，再授权完整执行；
- 将一次成功 Run 另存为个人 Recipe，再发布为公开 Recipe。

AI 负责规划和建议，执行仍通过 Main 权威的 TaskScope、权限和任务 journal；Renderer、CLI、MCP 与 Agent 使用同一 Recipe/Run 合同。任何“完成”必须对应真实输出、保存状态和 provenance，不能只显示节点成功。

## 6. Marketplace 与 GitHub Registry

推荐的分发链路是：

1. 作者在 GitHub 仓库中放置包文件和 manifest，并添加一个明确的 topic：`sparkvas-skill`、`sparkvas-recipe` 或 `sparkvas-tool`。
2. Registry 服务按 topic 发现仓库，读取 manifest、许可证、Release、兼容版本和依赖，执行 schema、包大小、路径越界、恶意归档和敏感信息预检。
3. 通过校验的版本进入 curated Registry，记录仓库、作者、版本、commit/Release、内容 hash、许可证、评分和下架状态。
4. 客户端只读取 Registry，不直接对全网 GitHub 搜索；安装时显示权限、依赖和兼容性，写入受管目录并保留安装 journal。
5. 更新使用新版本并行安装、健康检查、原子激活和可回滚；失败时保留上一版本。举报、下架和撤销会阻止新安装，但不删除用户已有项目中的历史引用。

Skill 可以在权限范围内自动安装。Recipe 安装前检查所需 Skill/Tool；Tool 必须在权限页确认，默认拒绝任意 shell、任意网络和任意用户目录访问。Marketplace 本期免费，manifest 保留 `price` 字段但固定为 `0`，不接支付和 DRM。

市场的信任等级建议为：官方维护、已审核作者、社区未审核。未审核包可以被发现，但不能静默执行 Tool；审核状态、版本 hash 和许可证必须始终可见。

## 7. 视觉与信息架构

### 页面骨架

- **项目顶栏**：项目、当前领域、Canvas/Studio、运行状态和账户/设置。
- **左侧**：资产、Recipe、Skill/Marketplace、运行历史；可折叠和布局预设化。
- **中间**：Canvas 或 Studio；两者共享当前 selection 和 Project。
- **右侧**：常驻项目 Agent，负责起草、解释、修复、审阅和执行。
- **底部**：当前 Run、权限确认、错误、输出槽位和导出状态。

Canvas/Studio 是项目内导航，不是两个产品模式。用户从 Canvas 进入 Studio 时，选中素材和上下文保持不变；Studio 输出的图片/视频回到 Canvas，并沿同一 provenance 链显示。

### UI Builder

采用布局构建器，而不是让用户拼装任意控件和逻辑。用户可以拖动、停靠、缩放、分栏和隐藏面板，保存不同工作台的 Layout Preset。布局只能组合受支持的 surface，不能改变权限、TaskScope、命令 schema 或数据所有权；失效布局自动回退到安全默认值。

### 主题

收敛为浅色和深色两套基础主题，支持用户强调色、三档密度、字号和布局预设。现有七套玻璃主题不再作为默认入口，保留一次导入兼容并迁移到基础主题。主题重构必须以单一 registry 为源，统一 `on-danger`、focus、surface、border、muted text 和 disabled 状态，清除 CSS fallback 漂移和跨层 `!important` 修补。图片和视频内容保持原色，不叠加主题滤镜。

## 8. 护城河假设

Sparkvas 当前没有已经成立的护城河；需要验证的组合假设是：

> **场景配方网络 × 可复核成果链 × 本地/BYO 执行信任。**

- **场景配方网络**：把电商摄影、导演分镜、镜头动作、连续性、商品材质和平台交付经验编码成可组合 Recipe/Skill。单个 Prompt 很容易复制，带输入输出契约、版本、示例和失败修复的配方更难替代。
- **可复核成果链**：每个输出都能回答使用了哪个素材、Recipe、Skill、Tool、模型、参数和版本；用户可以比较、回滚、重跑和迁移。
- **本地/BYO 执行信任**：用户选择自己的 Key、模型和本地 Tool，项目资产和凭据由客户端受管，平台不以账号和积分锁住创作。

三者会形成飞轮：作者发布 Recipe → 用户安装并运行 → 兼容性、成功率和示例质量得到反馈 → 更好的 Recipe 吸引更多作者。这个飞轮只有在版本兼容、运行证据和作者信誉真实存在时才成立；“有一个市场页面”本身不是护城河。

不建议正面竞争模型数量、素材库规模、最低推理价格、通用聊天 Agent 或底层节点数量。它们会被大厂、开源项目或 API 供应商快速商品化。

## 9. Sparkvas 品牌与迁移

品牌定名为 **Sparkvas**，副标题建议为 `AI-native visual workbench`，中文说明为“AI 视觉创作工作台”。`Sparkvas` 是 `Spark + Canvas` 的连写，保留火花与画布的意象；`SparkCanvas`、`SparkCanva` 不采用。此前 DNS 级初筛显示 `sparkvas.com` 已注册，`sparkvas.ai`、`sparkvas.studio`、`sparkvas.app` 与 `getsparkvas.com` 尚未发现有效 NS，但这不等于域名或商标可注册。

改名范围包括应用显示名、EXE、安装器、仓库、文档、CLI/MCP 展示名和更新源。迁移必须一次完成但保留兼容边界：首次启动把旧项目、设置、凭据 sidecar、快捷方式和更新状态迁入新目录；旧 CLI/MCP 命令保留一个版本的别名；持久化 schema 内部键不为品牌改名。App ID、安装目录、数据目录、更新签名和迁移失败回滚需要在实施前冻结并专项验证。商标第 9/42 类、域名所有权和搜索冲突仍需正式法律/注册核验。

## 10. 实施前必须解决的工程问题

1. **旧边界冲突**：`AGENTS.md`、`PRODUCT_INTENT.md` 和部分上下文地图仍写着“不做工作流编辑器、工具节点和计划节点”。实现前必须更新为本 ADR 的 Canvas/Studio/Recipe 边界，并明确不恢复任意底层节点编辑器。
2. **状态单一来源**：Studio、Canvas、独立 Agent、CLI/MCP 只能共享 Project/Selection/TaskScope/Run owner，不能各自保存一套 Recipe 状态。
3. **执行安全**：Skill 不执行代码；Tool 需要 manifest 权限、隔离、取消、日志和回滚；远程 GitHub 包不能直接进入生产执行路径。
4. **版本兼容**：Recipe 锁定 Skill/Tool 版本和能力 hash；缺失依赖、能力漂移或模型不支持时，先显示可修复计划，禁止静默替换。
5. **视频合同**：视频 Tool 必须有独立 create/poll/download journal、受管媒体路径和结果节点；不能用图片任务的成功状态伪装视频完成。
6. **内容与版权**：公开 Recipe 不能打包用户素材、私有 Key 或未经授权的第三方资产；作者需要声明许可证、来源和可分发范围。
7. **市场冷启动**：先由官方提供电商美妆和影视剧样例 Recipe，邀请少量作者，建立可运行的高质量基线，再开放无审核包的发现。
8. **主题和布局复杂度**：布局构建器必须限制在受支持的面板和停靠区；主题只维护浅/深两个基础语义集合，避免再次出现九套主题和 CSS 漂移。

## 11. 验收合同

产品方向达到可实施状态时，至少应能演示以下闭环：

- 从一张美妆商品图开始，Canvas 选中素材，Agent 生成可审阅 Recipe；
- 用户在 Studio 修改一个 Skill、一个镜头/场景步骤和一个输出槽位；
- 系统显示 Tool 权限、模型配置、输入输出与预计影响范围；用户确认后真实执行；
- 六张商品图和一个短视频结果回到 Canvas，保留来源、版本、Run 和错误/重试状态；
- 从 GitHub Registry 安装一个公开 Skill，显示许可证、hash、兼容版本和来源；
- 以同一套场景 Skill 把一张参考图生成分镜/镜头动作 Recipe，证明电商与影视共享内核；
- 用户修改布局、切换浅/深主题并重启，布局、主题、项目和凭据保持；
- CLI/MCP 查询与 GUI 看到同一 Recipe/Run 状态，不暴露 Key、绝对路径或私有 URL。

这些是行为验收条件，不是当前实现状态。当前图标化改动仍处于在制，旧产品边界与新方向尚未完成代码层迁移；本决策包不产生 EXE、安装或正式发布结论。

## 12. 参考证据

- [竞品扫描](../../artifacts/product-strategy-2026-11-16/competitive-scan.md)：Krea、Canva AI、Adobe Firefly Boards、FLORA、即梦、ComfyUI、InvokeAI、垂直电商/科研工具与 Agent 产品的来源和边界。
- [UI 现状审计](../../artifacts/product-strategy-2026-11-16/ui-audit.md)：当前九套主题、token 漂移、CSS 级联、危险色对比度、图标化在制和主题重构切入点。
- [领域词汇](../GLOSSARY.md)：Canvas、Studio、Recipe、Skill、Tool、Run、Registry、Marketplace 的定义。
- [ADR-0001](adr/0001-canvas-first-ai-native-workflow-authoring.md)：画布优先的 AI-native 工作流创作。
- [ADR-0002](adr/0002-brand-sparkvas.md)：Sparkvas 品牌定名与迁移原则。
- [ADR-0003](adr/0003-github-registry-and-permissioned-tools.md)：GitHub Registry 与受权限控制的 Tool 分发。
