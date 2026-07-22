# Image Gen 全局收敛与交付计划

## 目标

本轮把 IIimage Studio 从“功能已能运行”推进到可交付的图片生产工作台。右侧 Agent 仍是唯一智能入口；空白画布上的手动生图只是一条直接提交图片任务的快捷入口，不创建工作流步骤、Agent 节点或执行节点。所有改造优先修正 Prompt、Schema、原生协议、工具传输层、数据状态机和统一组件，不增加关键词路由、强制 tool choice、synthetic user 或外层强制纠错。

## 已确认事实与根因

1. 本机 `codex-cli 0.144.1` 的推理强度底层枚举包含 `low`、`medium`、`high`、`xhigh`、`max`、`ultra` 六档；当前本机模型目录为 `gpt-5.6-sol/terra/luna` 声明的可用档位到 `max`。IIimage 当前只接受前四档，属于协议能力缺失。应用应支持完整六档，并在服务端未来返回模型能力元数据时按模型收敛，不得继续把未知值静默改回 `medium`。
2. 模型列表主进程已有 60 秒内存/磁盘缓存和 in-flight 合并；前端第六次点击本应强制刷新，但 `modelLoadRef` 会在已有请求期间直接返回旧 Promise，可能吞掉真实刷新。
3. 空画布右键只剩“添加图片容器”。现有 `runManualImageTask`、比例/分辨率/质量规则和项目库参考图链路仍在，可恢复为直接提交式“创建生图工作”，无需恢复旧工作流节点。
4. 多处文本区同时拥有滚动条和浏览器原生 resize 手柄；项目 Agent 输入框末尾 CSS 又把前面的 `resize: none` 覆盖为 `vertical`，造成滚动条与拉伸手柄冲突。该问题应由统一文本区规范解决。
5. Agent 忙碌时 FastMemory 按钮被直接禁用；FastMemory 编辑器缺少 revision/updatedAt 乐观并发校验，编辑期间 Agent 写入可能被用户旧快照覆盖。
6. New API 图片请求当前超时在 180-600 秒之间动态变化，默认可能到 600 秒；没有可恢复错误的分类重试。手动生图 UI 也把失败写成“不自动重试”。
7. 多图展示同时依赖 `imageContainer`、`imageCollection`、`layoutGroups` 三套判断。虽然各自有局部排版，组件、尺寸、拖放、标题和状态逻辑仍然分叉，三图尤其容易出现尺寸与网格不协调。
8. AI 抠图/AI 重绘在网络任务完成后才关闭编辑窗口，阻塞画布操作。其他节点继续生成已能先关闭，本轮需把所有长任务统一为“校验并提交后立即关闭，状态进入节点/Agent 时间线”。
9. 标准单图内容同时承担点击查看与拖动节点。单击需要由明确的点击/拖动阈值状态机保护，不能因节点类型或刚结束的无效拖动失效。
10. 画布节点固定使用 512px 缩略图。节点放大、画布高缩放或高 DPI 下仍用同一源，导致明显模糊。
11. Agent 已有真实模型/思考/正文 delta 事件，但 UI 只显示“正在请求模型”或“处理中”。可直接用事件驱动为“正在思考 / 正在输出 / 正在工作 / 思考完成”，无需制造重复聊天消息。
12. `image_gen` 开始事件会提前创建生成中节点，但完成 action 只随整轮 Agent 返回应用；模型继续 `view_image`、输出正文或进入下一轮时，画布完成预览会慢半拍。
13. 默认 Agent Prompt 没有要求对 `image_gen` 输出执行 `view_image` 复核，也没有形成稳定的商业级基础画面质量规范。工具回执已有项目内输出路径，原生质检链路具备实现条件。

## 统一设计

### 1. 模型与刷新

- `ReasoningEffort` 接受六档并完整持久化、透传。
- 模型能力采用“完整枚举 + 可选服务端元数据”模式；不能把服务端未知档位静默丢弃。
- 第六次手动获取模型即使前一请求仍在执行，也必须在其完成后补发一次 `forceRefresh=true` 网络请求。
- 60 秒缓存、in-flight 合并、磁盘缓存和失败时 stale fallback 保留；这些策略不展示在 UI。

### 2. 图片工具可靠性

- 图片请求单次固定五分钟超时。
- timeout 最多重试一次；第二次 timeout 立即失败。
- 网络中断、429、408、425 和上游 5xx 等可恢复错误最多重试五次。
- auth、quota/balance、policy/safety、invalid input、missing reference、413 二次压缩失败等不可恢复错误直接失败。
- 重试必须位于图片传输层，并把分类、attempt/retry 元数据返回节点状态；主 Agent 不承担机械重试。

### 3. 统一图片容器核心

- 手动素材容器、生成批量、连续系列和画布归组统一映射为一个 `ImageContainerPresentation` 视图模型。
- 数据来源可继续兼容旧字段，但渲染、网格计划、尺寸、标题、拖放、导出和状态只调用统一核心。
- presentation mode 仅区分 `library`、`batch`、`series`、`layout`；不再复制容器组件。
- 网格：2 张双列；3 张一大两小；4 张 2x2；5-6 张 3x2；7-9 张 3x3；10 张四列。三图根据真实图片比例求解但限制极端列宽，保证主图与两张副图均可读。

### 4. 非阻塞编辑与高清显示

- AI 抠图/AI 重绘完成本地校验并生成 mask 后立即关闭；生成中与失败状态由画布节点和 Agent 时间线承接。
- 所有长任务编辑器按同一规则审计，文件保存等短原子操作可继续阻止关闭。
- 画布缩略图根据实际显示像素选择 512/1024 预览；所需像素超过缓存阈值时切换项目原图。查看器与编辑器始终使用原图。
- 单击图片打开查看器，双击图片/标题打开编辑器；拖动超过阈值才抑制点击。

### 5. 原生 Agent 生图闭环

- Prompt 按用途、主体、关键细节、构图、光线、文字、约束、输出意图组织复杂任务。
- 保留用户具体要求，不擅自添加故事、道具、口号或装饰；宽泛要求只补充有助于构图、材质、光线和商业可用性的细节。
- 默认基础质量要求为主体明确、层级清楚、构图有意图、光线与材质一致、特效克制、没有伪文字和无意义元素堆砌。
- 编辑任务明确“只修改 X，保持 Y”；参考图标注编辑目标、身份、风格或构图角色。
- `image_gen` 成功后，主 Agent 使用回执中的项目内路径调用原生 `view_image` 检查主体、构图、文字、尺寸和用户约束；明显失败时自主修正一次，不由外层系统强制调用。

## 分轮实施

### Round A：协议与可靠性

- 六档推理强度与设置迁移。
- 第六次真实刷新排队语义与回归测试。
- FastMemory busy 编辑、updatedAt 版本检查和冲突提示。
- 五分钟超时、分类重试、attempt 元数据与自测。
- Agent 活动状态机。

### Round B：画布入口与非阻塞交互

- 空画布右键：创建生图工作、导入图片、创建图片容器。
- 恢复精简的比例/分辨率/质量/数量/参考图手动生图编辑器，并直接生成图片成果。
- 全局 textarea resize/scroll 规范。
- 抠图/重绘提交即关闭和项目隔离。
- 单击查看器、双击编辑器回归。

### Round C：容器、高清与即时完成

- 统一容器 presentation core 和 CSS。
- 2-10 图自适应尺寸与三图视觉回归。
- 动态高清图片源。
- `image-response` 进度携带最终幂等 workflow action，消除成果慢半拍。

### Round D：Agent 品质与真实闭环

- 默认 Prompt 升级、未修改默认 Prompt 的安全自动迁移。
- `image_gen -> view_image -> final` 原生质检。
- 真实 `gpt-5.6-sol + gpt-image-2` 单图、三图、参考图编辑和抠图验证。

## 验收矩阵

- 构建：`pnpm run build`、`pnpm run test:bundle`。
- 协议：`pnpm run test:agent-protocol`、`pnpm run test:agent-text`、`pnpm run test:agent-text-ui`。
- 图片：`pnpm run test:image-layout`、`pnpm run test:image-import`、`pnpm run test:thumbnail-cache`、`pnpm run test:psd-export`。
- 项目：`pnpm run test:project-io`。
- GUI：`pnpm run aidebug:gui`，新增空画布三入口、六档设置、FastMemory busy、文本区手柄、三图容器、抠图提交隐藏、单击查看、高清源与即时完成断言。
- 性能：`pnpm run aidebug:performance` 与 evidence audit；容器排版和高清切源不得造成持续长任务或拖动退化。
- 真实链路：模型工具选择必须保持 `auto`，无 model-force、强制 tool choice、synthetic user 或参数纠正；图片生成后真实调用 `view_image` 并给出基于画面的简短结论。
