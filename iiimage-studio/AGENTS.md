# IIIMAGE STUDIO 开发约束

## 产品边界

- 本仓库只维护 Electron 桌面 GUI 和本地 Agent runtime。远端后端位于独立仓库，不要把服务端管理后台复制回来。
- 当前是傻瓜式单画布 AI 生图工作台，不要恢复“基础模式 / Agent 模式”切换。
- 右侧项目 Agent 是唯一控制中心，可折叠为窄侧栏但不能被卸载或替换；画布上的 Agent 核心节点、节点内对话框和手动工作流入口已废弃，不得恢复。
- 画布主要展示图片成果、图片容器及成果关系，只允许一种可执行的非图片原语：需求节点。需求节点保存用户可复用、可编辑的自然语言图片处理要求，关系必须保持“图片/容器/分层成果 → 需求节点 → 新图片成果”；它不能派生出计划、Prompt 步骤、工具节点、后期节点、子 Agent 或任意工作流节点。图片容器仍是素材整理视图。连接头只调整来源/成果关系，不得因连线动作自动执行任务；需求只可由用户明确保存并执行或右键再次执行。
- 空白画布右键保留“创建生图工作 / 导入图片 / 创建图片容器”三个直接操作。“创建生图工作”只是精简的手动图片请求表单，提交后直接调用现有图片执行链路并把成果放到右键位置；它不得创建任务节点、Prompt 节点、执行流程或恢复旧工作流编辑器。
- 外部拖入的图片或文件夹必须先复制到当前项目管理的图片库，再进入参考图容器或画布图片容器。不得直接保存或修改用户原始路径。画布批量拖入默认进入同一图片容器，容器图片可拖出成为独立成果。
- `image_gen` 是唯一图片执行工具，允许的任务语义为 `generate`、`edit`、`replace`、`variants`、`layers`、`cutout`、`redraw`。主 Agent 可使用与 Codex 对齐的 `shell_command`、`view_image`、Responses 原生 `web_search`，以及 IIimage 的 `experience` 与成果查询工具完成任务；不得自建 Bing/DuckDuckGo 搜索器。`view_image` 必须把本地图片作为 `input_image` 回到当前主模型上下文，不能另起一次视觉模型请求代替。conversation compact、toolmemory 和底层 `context_manage` 由运行时维护，不向主 Agent 暴露内部 entry ID。这些过程不得创建画布节点或演化为手动工作流。
- `view_image detail=high` 可为模型上下文生成受控尺寸、受控请求体的观察副本，`detail=original` 保留原分辨率；两者都不得覆盖项目原图、降低画布预览清晰度或把大体积 base64 长期写入会话持久化。
- `replace` 和 `variants` 必须自动使用当前选中图片或附件作为来源；不得要求模型猜测或输出本地路径。`variants` 输出独立图片并使用 `variant` 关系。
- `layers` 必须生成真实合成预览、独立同尺寸 PNG 图层和重组校验结果；非背景层优先透明。不得只创建图层说明节点或伪造完成状态。
- `cutout` 必须通过图片模型生成可可靠移除的背景并在客户端验证真实 alpha；`redraw` 没有蒙版时必须打开选中成果的涂抹界面，用户提交后再执行图片模型。两者都生成新的图片成果和来源关系。
- 用户选中画布成果后，该成果必须作为右侧 Agent 的当前上下文；继续生成或修改得到的新成果应自动显示到画布并记录来源关系，即使模型没有显式传入父级也要使用当前成果兜底。执行需求节点时，Agent 的 SOURCE 必须来自需求节点左侧连接的图片/容器/分层成果，输出必须连接到需求节点右侧；需求节点本身不能伪装成图片 SOURCE。
- 画布空白态不属于 Agent 当前选中：没有节点被选中时，不显示“当前选中”或“将基于画布”，也不得把画布本身作为 `selectedNodeId` 传给 Agent。
- 普通图片连线只表示 `derived-from`、`referenced`、`variant`、`grouped` 等成果溯源关系，不表示执行顺序。需求节点使用 `referenced` 接收一个图片类来源，并以 `derived-from` 连接执行成果；连线本身仍不触发执行。
- 每个项目拥有项目级会话历史和成果空间。新建会话不会创建新 Agent，也不能清空画布成果。
- 主 Agent Prompt 是可编辑的 v2 纯文本配置；工具 Schema、conversation compact summary 和按 `projectId + conversationId` 隔离的 FastMemory 必须与 Prompt 分开维护。不得重新引入 Prompt entries 或在公开 UI/主模型上下文暴露 `entry_id`、`fmem-*`、selector 等内部元数据。
- 客户端不得在 UI、日志或公开设置中展示上游 Key、relay token 或 session cookie。

## 实现规则

- 先修改真实数据链路和组件本体，再改样式；禁止用不断追加的末尾 CSS 覆盖掩盖错误参数。
- 维持少文件、清晰分区的结构。只有能显著降低复杂度或支持懒加载时才拆新模块。
- `src/main.tsx` 只保留跨域状态与编排；认证、图片查看、参考图选择、窗口控制等已抽出表面不得重新内联。
- 设置默认值、兼容迁移和浏览器回退存储由 `src/settings-persistence.ts` 直接拥有；新代码不要通过 `src/core.ts` 引入这些符号。
- `src/styles.css` 只维护 01→08 的有序 `@import`。样式应写入对应 `src/styles/*.css` 区域，`08-motion-accessibility.css` 始终最后，禁止用改 import 顺序掩盖级联问题。
- `electron-main.cjs` 与 `agent-runtime.cjs` 是编排 facade；已进入 `desktop/` 或 `runtime/` 的纯逻辑不得复制回入口文件。
- 所有项目配置、输出和诊断默认留在仓库或用户明确选择的项目文件夹内。
- 模型列表必须完整保留服务端返回值；筛选只能作为用户可见选择，不得静默丢弃模型。
- 模型列表由 Electron 主进程统一缓存至少 60 秒；缓存有效时设置页、模型弹窗和 Agent 模型查询不得重复访问服务器。缓存文件不得包含 token、cookie 或上游 Key。
- Agent 图片工具必须真实执行。未实现的能力要明确返回边界，不得伪造进度或结果。
- 图片任务优先且默认使用 `gpt-image-2`；只要模型池中存在 `gpt-image-2`，不得因编辑、透明背景或抠图任务回退到旧图片模型。
- 滤镜、本地后期、Prompt/后期节点和 `apply_post_effect` 已废弃。不得恢复工具 schema、运行时 action、画布渲染、菜单、样式或 AIDebug 套件。
- 旧项目中的非图片节点和 `agentOwnerId` 只作为迁移输入读取；合法 v1 需求节点可保留，其余无图片资产的非图片节点保存后移除，有有效图片资产的旧节点迁移为图片成果；旧 Agent 会话历史保留在项目会话列表中。
- 旧版本只可作为经用户明确认可的连接点、无箭头线路动画、窗口排版等局部设计参考；不得把 `--legacy-full-suite` 当成新版兼容目标，也不得因旧断言失败恢复旧 Agent、旧工作流、旧窄屏交互或旧信息架构。

## 验证

- 每次改动至少运行 `corepack pnpm run build`。
- 生产构建还必须运行 `corepack pnpm run test:bundle`；正式 JS 不得包含 `__iiimageAIDebug`、`runLayerStackSuite`、`runMixedStressSuite` 等诊断控制面，废弃风格库资源不得被复制进 `dist`。
- `test:bundle` 的初始 JS 上限保持 600 KB；总 JS 仅为模块边界保留 652 KB 的窄幅预算，不得把它当作新增功能体积余量。
- UI、Electron、项目或 Agent 改动必须运行 `corepack pnpm run aidebug:gui`，检查报告和截图。
- 运行时或 `view_image` 改动还必须运行 `corepack pnpm run test:view-image`；真实 Agent 验证优先使用当前 `--agent-only`、功能专项和 `--real-agent-suite`，不以旧版全量套件作为交付门槛。
- AIDebug 断言必须检查可见性、裁切、尺寸和真实状态，不能只检查 DOM 是否存在或文字值是否正确。
- 真实服务端测试不得输出凭证；只汇报状态、数量和无敏感信息的错误摘要。

完整产品意图和历史覆盖关系见 `PRODUCT_INTENT.md`。

## 上下文地图维护

- `docs/CONTEXT_MAP.md` 是当前进程拓扑、模块所有权、跨边界契约、持久化位置和测试映射的权威导航。
- 新增、删除或移动模块，新增、删除或重命名公共符号，改变 preload/IPC/API/Agent tool schema/runtime action schema，改变项目 session、manifest、资产身份、memory 或更新清单等持久化格式，或者新增、删除、重命名测试入口时，必须在同一批改动中更新 `docs/CONTEXT_MAP.md`。
- 修改 Renderer、Electron Main、Agent runtime 或远端服务之间的镜像规则时，必须在上下文地图中写明两侧位置、同步不变量和对应验证，不能只更新单边说明。
