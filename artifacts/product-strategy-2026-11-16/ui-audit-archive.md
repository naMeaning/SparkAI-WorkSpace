# UI 现状与重构切入点

2026-11-16。以下分析记录当日所见，不代表当前主线状态。已提交源码的引用固定到审计基线 `0e0f1a8`；图标化观察来自当时未提交工作树。本轮未运行产品 UI。P1/P2 的两份 Electron report 与 delivery JSON 均实读为 `ok=true`，代表各自冻结源码的历史证据。

## 主题与样式现状

当前可选 **9 个主题**，七个玻璃预设为绯樱夜光、蜜橘融光、翡翠黑曜、雾银玻璃、柠檬晶糖、天青冰璃、蜜桃珍珠，另有实色“日间”“夜间”。新装默认 `light-classic`。`clear/frosted/dense/custom` 是材质维度，强调色另有主题色和五个色样。[默认第5行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/runtime/glass-theme-presets.json#L5) [themeOrder 第11行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/runtime/glass-theme-presets.json#L11)

九主题都经 JSON registry → `glassAppearanceProjection` → root CSS 变量投影，覆盖背景、表面、文字、强调色及材质。实色主题把模糊、噪点、背景图关闭，同时保留保存的玻璃参数。Glass Lab 首层提供日夜，七玻璃主题位于“更多外观”。旧 palette/custom 仍有类型、导入导出及 CSS，但 `ThemePalettePicker` 仅被导出、`applyTheme` 只有定义，当前源码未见调用，不能计入现行主题数。[投影第278行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/glass-theme.ts#L278) [入口第186行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/glass-lab.tsx#L186) [旧入口第73行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/settings-runtime.ts#L73)

变量层还有 `--glass-*` 视觉权威与 `--theme-*` 兼容桥的双层结构，后者仍被大量业务规则消费；重构应固定“glass 源 → theme 桥”的方向，而不是再叠一层覆盖。[桥接第5行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/01-liquid-glass-tokens.css#L5)

这里有一个需产品层确认的冲突：代码新装是实色 `light-classic`，由 `isSolidTheme` 判定，solid CSS 关闭 `backdrop-filter`、噪点和背景图；PRODUCT_INTENT 仍规定透明玻璃默认且 `dark-ember + frosted`。P1 设计曾建议新装日间，但交付把它变成默认后，产品意图没有同步。这是默认视觉方向变化，不应只当文档错字。[实色判断第170行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/glass-theme.ts#L170) [solid CSS 第407行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/01-liquid-glass-tokens.css#L407) [设计第57行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/docs/SparkAI-UI-Design-2026-10-24.md#L57)

`styles.css` 保持 01→08。01 负责基础控件、palette 和 Glass 桥接，02 负责画布/节点/菜单，03 仍被全局引入但标为旧 Agent 参考，04 负责弹窗/设置，04b–j 等由业务组件按需引入，05 负责桌面密度，06 负责响应规则，07a–i 承担历次归一化与修补，07j 兼管玻璃表面、素材轨和视图布局，08 最后执行动效无障碍策略。03 的遗留加载应在重构时确认是否仍有真实消费者，不能继续作为主题来源。[入口第23行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles.css#L23)

## P1/P2 成果与结构问题

P1 已落地日夜语义色、新装默认、旧偏好迁移、首帧与独立窗同步、作品原色保护及共享字号。P2 已收纳项目/视图/工具/单图/Agent 入口与五类设置，保留即时保存、草稿保护和停止 pending。历史实测覆盖 1280×800、884×640、日夜与独立窗，真实 DPI 尚未验证。[P1 证据](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/PROGRESS.md) [P2 证据](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/PROGRESS.md) [P1/P2 记录](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/docs/UI_SIMPLIFICATION_2026-10-24.md#L3)

仍有四项结构问题。

- **token 重复与漂移**。registry、启动 JS、CSS fallback 各有数值副本，独立窗 renderer 还硬编码主题 ID 和变量白名单。CSS 的 dark-rose 色样 surface 为 `#4a1e33`，registry 为 `#1c151a`。运行投影会覆盖它，但 fallback 已偏离。PRODUCT_INTENT 第71行仍写新装默认蜜橘/玻璃，和代码 `light-classic` 实色不同；其“七套”若指七个玻璃预设，则数量可与代码对应，真正未同步的是默认策略。[CSS 第52行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/01-liquid-glass-tokens.css#L52) [registry 第84行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/runtime/glass-theme-presets.json#L84) [独立窗第40行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/agent-window-renderer.js#L40) [产品意图第71行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/PRODUCT_INTENT.md#L71)
- **级联承担组件职责**。06 的夜间按钮硬编码加 `!important`，07j 再用 `!important` 修补顶栏。07j 的全局 surface 名单、重复 class 增权和实色例外使一个控件的最终状态跨文件决定，新 surface 容易漏接。[06 第84行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/06-responsive.css#L84) [07j 第464行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/07j-liquid-glass-surfaces.css#L464) [surface 第603行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/07j-liquid-glass-surfaces.css#L603) [重复 class 第617行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/07j-liquid-glass-surfaces.css#L617)
- **状态语义不完整**。危险实心按钮固定白字，夜间 danger 为 `#ff8477`，静态对比约 **2.38∶1**。在制图标按钮仍回退白色，未找到 `--danger-ink` 定义，需要成对的前景/背景 token。P1 已测基础正文对比不能覆盖此状态。[按钮第880行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/01-base-controls.css#L880) [夜间 danger 第47行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/runtime/glass-theme-presets.json#L47)
- **密度与控件分裂**。基础辅助字为12px、操作34px，搜索结果却硬写11/10px，关闭按钮30px。主窗使用 React primitive 与 OverflowTooltipLayer，独立窗另有34px控件及伪元素提示，行为需两边维护。[局部第448行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/07j-liquid-glass-surfaces.css#L448) [10px 第453行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/07j-liquid-glass-surfaces.css#L453) [关闭 30px 第356行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/src/styles/07j-liquid-glass-surfaces.css#L356) [独立窗第199行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/agent-window.css#L199) [提示第209行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/agent-window.css#L209)

主窗已真正 token 化的是 registry 驱动的九主题表面、文字、强调色和材质；独立窗仍有自己的 fallback 映射。局部硬编码集中在 06 夜间补丁、07a 的旧 flattening、07j 的少数 `#fff`/深色浮层及 9–11px 字号。旧 `01-theme-palettes.css` 仍被全局加载，但主窗当前没有设置 `data-theme-preset` 的产品入口，更像死层；独立窗仍保留 `data-palette` 的 legacy 分支，不能视为已全部清理。[独立窗 legacy 第55行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/agent-window-renderer.js#L55)

## 重构范围与成本

最小可行范围应以现有 registry 为源，统一语义色及 on-danger、表面层级、焦点、字号、间距和命中区，将控件状态收回共享 owner，核对 bootstrap/主窗/独立窗投影，再逐区清除被替代规则。不新增第二套主题 registry，不把局部审美微调包装成信息架构重做。验证覆盖九主题的投影、日夜关键状态、玻璃复杂底图、最小窗口与作品原色，最后按仓库流程生成并安装本地 EXE。

| 范围 | 产出与相对成本 |
| --- | --- |
| 视觉换肤 | 调整现有 token、字体与材质，成本小，级联和重复控件仍需维护 |
| 设计系统重构 | 统一 token、共享控件状态与样式 owner，成本中，适合作为本次最小范围 |
| 信息架构重做 | 改入口、导航和任务路径，成本大，涉及动作发现与业务回归，需独立产品合同 |

本轮排除范围为设置独立窗口、服务协议、画布/Agent 状态模型和领域导航重做。P2 已有入口收纳应作为基线。[原范围第13行](https://github.com/naMeaning/SparkAI-WorkSpace/blob/0e0f1a8901003b6ebd390f236c62bf8643531162/sparkai_workspace/docs/SparkAI-UI-Design-2026-10-24.md#L13)

## 图标化接续条件

当前分支 `main`、图标任务基线 `0e0f1a89`。diff 为41个 tracked 文件、478增/449删。源码与样式改动属于图标化在制，两个 `public/*.css` 也是为图标按钮排除旧按钮规则；GOAL/PROGRESS/规则/ledger/README 等文档 dirty，既有当前状态同步，也有保留的旧文档改动，不能仅凭 diff 判断它们已完成。未跟踪的设置设计与交接文档属于更早的配置任务，不能算本轮完成。

ActionButton/MenuItem 已新增默认 iconOnly，IconActionButton 增加 busy/variant，菜单正从文字行改图标网格。默认 iconOnly 会改变带 icon 的既有 ActionButton/MenuItem 呈现；IconActionButton 新增 busy 后会把忙碌态变为 disabled。接续前必须回归原动作语义。现有 Tooltip 仍由 OverflowTooltipLayer 提供 hover350ms/focus/Esc。矩阵全部仍标“待实施”，`PROGRESS` 仍写实施中；本轮 UI/EXE/安装/推送证据尚未形成。图标化当前不是可据以宣称完成的基础。

视觉方向与 token 表可先讨论。源码接续宜等图标动作/内容例外矩阵、共享控件合同和主/独立窗验证闭环，形成可识别提交及制品基线，减少同改01/02/07与共享控件的冲突。若主题重构先做，应与图标化分离工作树，不能让两个任务同时改共享控件状态、按钮尺寸和 Tooltip 样式；否则无法判断回归来自哪一批在制改动。

## 三个视觉方向

| 方向 | 产品气质 | 风险与验证 |
| --- | --- | --- |
| 中性精密工作台 | 长时间创作、参数配置与高密度操作 | 层级过平，需验证焦点、主动作、错误和选中能否迅速识别 |
| 克制玻璃创作室 | 延续品牌材质与创作氛围，阅读表面提高稳定性 | 背景影响对比及 GPU 开销，需复杂底图对比、滚动/拖动与首帧测量 |
| 成果优先画廊 | 突出图片比较、筛选与交付，工具采用紧凑边栏 | 控件发现成本上升，需新用户完成选图→编辑→比较→导出的路径验证 |

三方向均可共用上述 token/组件基础。具体选择须通过同一项目、同一素材与同一任务的可操作原型比较。
