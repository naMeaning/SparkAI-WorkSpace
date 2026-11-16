# Sparkvas 领域语言

这个上下文描述桌面端画布优先 AI-native 视觉工作台的产品概念。它只定义术语，不记录实现细节或任务状态。用户可见品牌为 Sparkvas；Phase 7 前，安装器、可执行文件、App ID、CLI/MCP 和现有用户数据目录仍可能保留兼容技术名。

## 产品形态

**Project**：
一个独立的工作空间，拥有自己的画布、项目 Agent、会话历史、成果资产、知识、Recipe 绑定和持久化设置。
_Avoid_: 工作区（当指 Project 时）、文件夹

**Canvas**：
项目的主创作面，承载图片/视频成果、图片容器、需求节点和成果关系；它不是工作流图的默认视图。
_Avoid_: 工作流画布、节点图

**Studio**：
画布优先产品中的第二创作面，用于查看、编辑和运行 Recipe；从画布选中素材进入，产物回到画布。
_Avoid_: 工作流模式、节点编辑器（当指整个产品时）

**Recipe**：
可版本化的创作配方，由 Skill 与 Tool 组成，声明输入槽位、输出契约、适用条件和来源；它既可以由 AI 生成，也可以由用户编辑。
_Avoid_: Workflow（当含义是 Recipe 时）、工作流（未限定层级时）

**Recipe Run**：
某个 Recipe 版本的一次冻结执行实例，绑定输入资产、依赖版本、权限确认、步骤状态、输出资产和 provenance。
_Avoid_: 运行记录、任务（当需要区分配方定义与执行实例时）

**Skill**：
声明式创作技法，包含提示词、参数、示例和约束，不执行任意代码；例如景别、运镜、光线、构图和分镜方法。
_Avoid_: Prompt 模板、插件、工具

**Tool**：
可执行适配器，负责调用图片/视频模型、ComfyUI、Python 或 MCP 等外部能力；安装和执行都需要显式授权与权限说明。
_Avoid_: Skill、插件

**Permission Manifest**：
Tool 对网络、文件、进程、模型和外部服务所需能力的明确声明，安装和执行前必须可见并可审阅。
_Avoid_: 权限提示、插件说明

**AI-native**：
AI 是 Recipe 的第一作者，能根据目标起草、修改、解释、修复并运行 Recipe；人类保留审阅、锁定、接管和授权。
_Avoid_: AI 辅助、聊天助手、自动补全

## 画布与执行

**Requirement**：
画布上唯一可执行的非图片原语，保存用户可复用、可编辑的自然语言图片处理要求；关系保持“来源 → 需求 → 成果”。
_Avoid_: Prompt 节点、计划节点、工作流节点

**TaskScope**：
一次执行被冻结的项目、素材、参数、模型、权限和来源范围；执行期间不允许静默漂移。
_Avoid_: 任务参数、运行配置

**Provenance**：
成果与其来源素材、Requirement、Recipe、Skill、Tool、模型和参数之间的可追溯关系。
_Avoid_: 来源信息、历史记录（当含义是 Provenance 时）

**Workspace Domain**：
同一 Project 上的能力投影，当前为 `general`、`commerce`、`social`、`research`；切换领域不复制画布、会话或资产。
_Avoid_: 模式、子应用

## 定制与分发

**Layout Preset**：
用户保存的面板停靠、尺寸、分栏和显隐组合；它改变工作台布局，不改变控件、页面或业务逻辑。
_Avoid_: UI Builder（当含义是 Layout Preset 时）、主题

**Registry**：
对 GitHub 上带约定 topic 的 Skill/Recipe 包进行校验后生成的策展索引；客户端只读取 Registry，不直接全网搜索。
_Avoid_: 市场（当指索引时）、应用商店

**Marketplace**：
用户浏览、安装和更新 Registry 中 Skill/Recipe 的产品表面；本期只提供免费内容，价格字段保留但固定为零。
_Avoid_: 插件商店、付费市场（当本期固定免费时）
