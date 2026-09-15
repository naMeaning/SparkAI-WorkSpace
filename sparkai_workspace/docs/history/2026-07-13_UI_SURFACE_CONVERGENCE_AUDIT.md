# UI Surface 统一性审计

更新时间：2026-07-16

## 一、审计结论

当前已经建立可靠的 `DialogShell / SurfaceHeader / SurfaceBody / SurfaceFooter / ActionButton` primitive，并具备：

- Surface 栈管理。
- Escape / backdrop / close button / action 分别配置关闭策略。
- busy、dirty 状态门禁。
- Tab 焦点循环与关闭后焦点恢复。
- 统一 `data-ui-surface`、`data-ui-busy`、`data-ui-dirty` 观测接口。
- normal / reduced-motion 共用的统一入场动效。

当前所有产品级 modal 已统一进入 `DialogShell`，设置与账户进入 `DrawerShell`。已迁移范围包括：

- 通用确认框、项目创建/重命名、余额、删除成果。
- Agent 主提示词、FastMemory、模型配置、参考图与 Agent 追问。
- 图片查看器、成果编辑器、AI 重绘/AI 抠图、分层查看器。
- 设置与账户 Drawer。

旧的手写 `dialog-layer + backdrop` 产品实现已从 `src/main.tsx` 清除。CSS 同步删除旧 header/footer/button 和未引用编辑器规则，正式 CSS 已降至约 168KB；迁移不靠样式表末尾追加覆盖。

## 二、迁移完成清单与剩余审查

### P0：图片工作主链路（已迁移）

1. 统一成果编辑器 `unified-node-editor`
2. AI 重绘 / AI 抠图 `region-redraw-dialog`
3. 分层查看器 `layer-group-viewer`
4. 图片查看器 `image-viewer`

这些界面已拥有稳定 Surface 名称、统一焦点/关闭策略、标准与最小窗口证据。专业 Viewer/Canvas 内容布局仍保留，不被强行改成普通表单。

迁移原则：

- 保留专业内容布局和手势，不把 Viewer 强行改成普通表单。
- 外壳统一使用 DialogShell；Header / Footer 使用 primitive，Body 保留专用 stage。
- busy 时禁止 backdrop / Escape 关闭正在生成或导出的任务。
- 编辑器 dirty 时必须明确保存、放弃或继续，不允许误触直接丢失提示词/蒙版。
- 查看器主图继续使用 original，缩略条继续使用 thumbnail。

### P1：Agent 与素材输入（已迁移）

1. 参考图选择器 `reference-picker-dialog`
2. Agent 追问 `ask-user-dialog`
3. 新建项目 `project-create-dialog`
4. 余额不足 `quota-dialog`
5. 删除成果 `delete-node-dialog`

这些界面已统一 Header / Body / Footer / ActionButton 语义，英文功能 eyebrow 已移除；删除与确认继续保留不同业务内容，但共享危险按钮和关闭策略。

### P2：Drawer（已迁移）

1. 设置 `settings-drawer`
2. 账户 `account-drawer`

Drawer 保留侧滑布局，并已复用 Surface stack、焦点恢复、Escape、backdrop 和 busy policy。

## 三、当前可验证缺口

- 专业工具栏仍保留少量专用图标按钮；需要继续审查其 tooltip、禁用态和 884px 下命中尺寸，而不是为了形式统一全部替换为文字按钮。
- 分层查看器 Footer 功能较密集，需要持续验证更窄窗口的折行与主次优先级。
- dirty/busy 关闭策略已经进入统一 Shell，但 AI 蒙版和成果编辑器仍需继续扩展“首次关闭提示、再次确认”的长期手势证据。
- Agent-only 专项仍有少量旧 CSS selector / fixed delay 需要迁移到稳定 `data-ui-surface` 契约。

## 四、迁移顺序

### Round UI-1（完成）

- ImageViewer + LayerGroupViewer。
- 新增 `data-ui-surface="image-viewer" / "layer-group-viewer"`。
- AIDebug 覆盖：1280、884×720、884×640；原图/缩略图边界；滚轮缩放、拖动、Esc、焦点恢复、右键菜单层级。

### Round UI-2（完成）

- UnifiedNodeEditor + RegionRedraw。
- AIDebug 覆盖：长提示词、无提示词、分层节点、容器第二张、dirty、busy、蒙版已绘制/未绘制、窗口最小高度。
- 统一 Footer：取消 / 保存 / 导出 / 继续生成按语义分组，不用说明文字填补空白。

### Round UI-3（完成）

- ReferencePicker + AskUser + Project/Quota/Delete。
- 删除重复确认框实现。
- 统一空态、错误、计数、分页和危险操作二次确认。

### Round UI-4（完成）

- Settings / Account Drawer 接入 Surface stack。
- 验证 Drawer 上叠加 Model Config、Prompt Editor、FastMemory Editor 时的焦点与 z-index。

## 五、完成标准

- 产品内每个 modal/drawer/viewer 都拥有稳定 `data-ui-surface`。
- Escape、backdrop、关闭按钮、busy、dirty 行为由同一 close policy 决定。
- 打开后焦点进入 Surface，Tab 不逃逸，关闭后回到触发入口。
- Header / Body / Footer 间距、按钮高度、危险/主要/次要动作和窄屏折行一致。
- AIDebug 不只检查 DOM 存在，还检查可见面积、裁切、按钮尺寸、焦点、滚动、手势冲突和真实截图。
- 不在 `styles.css` 末尾追加一批临时覆盖；每次迁移清理对应旧选择器和重复规则。

## 六、最新严格证据

- Agent Text UI：`.diagnostics/electron/agent-text-ui-2026-07-13T03-21-57-595Z/report.json`，覆盖设置/账户 Drawer、Prompt/FastMemory、Model Picker、Confirm、Tab trap、焦点恢复、dirty/busy、normal/reduced motion 与退出后唯一登录页，0 failure。
- 分层查看器与成果编辑器：`.diagnostics/electron/aidebug-2026-07-13T03-18-14-782Z/report.json`，8 个场景，evidence audit 0 error / 0 warning。
- 图片查看器与普通成果编辑器：`.diagnostics/electron/aidebug-2026-07-13T03-19-22-255Z/report.json`，8 个场景，evidence audit 0 error / 0 warning。
- AI 抠图：`.diagnostics/electron/aidebug-2026-07-13T03-20-58-975Z/report.json`，0 failure。
- AI 重绘：`.diagnostics/electron/aidebug-2026-07-13T03-21-20-052Z/report.json`，标准结果与 884px 编辑器均通过，evidence audit 0 error / 0 warning。

## 六、2026-07-13 实际收束结果

本文件前半部分是迁移前审计，当前状态已经推进到：

- P0 全部完成：成果编辑器、AI 重绘/抠图、分层查看器、图片查看器均使用共享 Surface；图片查看器主图/缩略图边界、另存为、PSD、884 宽度均有专项证据。
- P1 全部完成：参考图、Agent 追问、新建/重命名项目、余额不足、删除成果和通用确认已迁移到共享 Header/Body/Footer/ActionButton。
- P2 全部完成：新增 DrawerShell，Settings 与 Account 共享 Dialog stack、aria-modal、Escape/backdrop、busy/dirty policy、Tab trap 和焦点恢复。
- 已砍掉的 Style Library、Frame Picker、Card Wizard 不再保留假入口；遗留 CSS 与浮窗注册清理约 34KB。
- Settings 旧级联再清理约 10KB；模型卡、获取模型、配置模型、编辑提示词在 884×720 对齐且无横向裁切。
- Account 专项报告：`.diagnostics/electron/agent-text-ui-2026-07-13T02-49-16-648Z/report.json`。884×720、1280×820、busy 关闭门禁、焦点恢复、退出登录后的唯一登录壳、注册切换和错误态全部通过。
- 人工截图复核确认账户三列余额、操作按钮、日志密度、登录/注册输入框与错误提示没有裁切、重叠或失去样式。

当前仍需继续的是长期一致性维护：新增 Surface 必须直接复用 primitive；AIDebug selector 必须使用稳定 `data-ui-surface`，不能重新依赖已删除的旧类名。

## 七、2026-07-16 Agent 文本、状态与成果容器收束

- Agent 只读 Markdown 已完整支持 GFM 表格、删除线、任务列表、`www` / 邮箱自动链接与脚注；渲染链路使用 `mdast-util-gfm + micromark-extension-gfm`，正式 bundle 不再依赖会导致兼容漂移的旧插件组合。
- 审查发现一段历史 Agent CSS 位于未闭合注释之后，约 800 行旧壳样式从未进入有效样式树。该区域现被明确封存为旧样式参考，没有重新启用旧 Agent 壳；当前 Markdown、工具卡与消息排版所需规则已迁入有效 Project Agent 区域。后续不得通过“补一个注释结尾”意外恢复整套旧信息架构。
- 动态运行状态已收束为单一主源：右侧 Agent 时间线显示 `Image Gen 正在绘图 Ns`；成果节点头部仅显示“单图 / N 张”，生成占位为静态图片图标，画布底栏仅显示成果数量。画布 DOM 断言禁止出现“生图中 / 生成中 / 正在生成 / 运行中 / 正在透明化并重组”，失败终态除外。
- 图片容器改为真实宽高比感知布局。三张同类比例图片使用等宽 3×1 比较行；只有横图或竖图确为离群项时才使用上主图或左主图拼版。4-10 张混合比例通过展示顺序平衡横竖图，但资产索引、提示词和拖动目标仍指向原始资产。手动容器与 Agent 批量结果继续共用同一底层。
- AIDebug 新增 `imageContainerLayout`、状态唯一性、三图等宽、六图 decode 等真实观测；图片加载断言会等待 `decode()`，不再把忙碌环境下的延迟误判为布局失败。

最新严格证据：

- Agent Text / GFM / 状态唯一性：`.diagnostics/electron/agent-text-ui-2026-07-16T07-12-17-709Z/report.json`，全部通过。
- 图片容器、真实 DOM 几何、同类三图等宽行、宽图离群拼版、归组/拆出/层级/编辑/保存闭环：`.diagnostics/electron/aidebug-2026-07-16T07-18-00-416Z/report.json`，0 failure。
- 真实 `gpt-5.6-sol + gpt-image-2` 电商首图与三张独立变体：`.diagnostics/electron/aidebug-2026-07-16T06-11-28-788Z/report.json`。
- 开发态性能真值基线：`.diagnostics/electron/aidebug-2026-07-16T07-29-52-377Z/report.json`；1000 节点仅挂载 27 个可视节点，平移/缩放 P95 约 7ms，十张 4K 图片冷缩略图约 1.825s、热缓存约 26ms，清理后仅保留约 0.68MB 堆增量。严格审计 0 error / 0 missing；3 条 warning 仅说明当前是开发态基线且观测到 50-79ms 长任务，不代表已经声明正式产品阈值。
- 正式构建：JS `632,508 B`、CSS `171,853 B`、总计 `854,950 B`，生产 bundle 泄漏检查通过。
