# Round 0：旧 Goal 真实收口计划

更新时间：2026-07-12

## 目标

在开启长期产品硬化 Goal 前，先把当前画布交互、分层 PNG、Agent 上下文隔离和导出阶段收口。历史“全绿”不作为本轮结论；只接受本轮源码、本轮报告、本轮截图和独立证据审计。

## 已修复的真实阻断

六个独立 PNG 节点虽然位于同一锚点，但深色主题给每个 stacked 节点恢复了不透明卡片背景；同时隐藏的 badge 使 `:first-child:last-child` 选择器永远无法命中图片 tile。结果是上层文字节点遮住下层，中央只剩文字条，或整幅合成被暗色画布覆盖。

当前修复：

- stacked 节点在浅色/深色主题下都保持透明背景。
- stacked 成员不建立隔离绘制上下文。
- stacked 图片 tile 无条件透明，不再依赖 DOM 子节点位置。
- 逐层图片不应用会改变合成结果的阴影。

最新视觉证据：

- 报告：`.diagnostics/electron/aidebug-2026-07-12T21-31-01-636Z/report.json`
- 中央截图：`.diagnostics/electron/aidebug-2026-07-12T21-31-01-636Z/layer-stack-suite-1280.png`
- 重组 PNG：同一 run 的 `group-001/99-recomposed-1e7912e2399de5eb.png`
- 中央截图与重组图采样：`matchRatio=0.9984`、`meanDelta=1.038`、无 failure reason。

## 剩余工作

### 1. 稀疏透明层证据

- 标题和正文层内容面积很小，固定 14×14 缩采样会错过有效像素。
- 采用自适应高密度采样或按源文件有效 alpha 区域映射屏幕采样。
- 不降低独立 PNG alpha、尺寸、唯一哈希和中央合成截图硬门。
- AIDebug 报告必须区分“源文件有效、屏幕有效、采样未命中”，不能把未观测写成通过。

### 2. 画布真实手势闭环

- 真实从一个容器拖入另一个容器，验证命中栈、吸附高亮、成员顺序、源容器降级、zOrder 与因果关系。
- 分层合并为普通图片后，真实拖动到空白位置并归入普通容器；原六层组保持不变。
- 把无关节点移动到关系线中间，验证路径 `d` 不变且仍为单段 Bézier，不做障碍避让。
- 创建两条交叉关系线，验证后创建线位于上层，并在保存/恢复后保持顺序。
- 图片主体拖动保存拖前、拖中、拖后三帧，验证跟手、松手稳定、选择高亮和过渡参数。

### 3. 全量回归

必须重跑：

```text
node scripts/aidebug-gui.mjs --layer-stack-suite --mock-agent --port=<free>
node scripts/aidebug-gui.mjs --image-collection-suite --mock-agent --port=<free>
node scripts/aidebug-gui.mjs --agent-only --mock-agent --port=<free>
node scripts/aidebug-gui.mjs --auth-gate-suite --port=<free>
pnpm run aidebug:evidence -- --report=<每份报告> --no-write
pnpm run test:agent-text
pnpm run test:agent-text-ui
pnpm run test:image-layout
pnpm run test:psd-export
pnpm exec tsc --noEmit
pnpm run build
git diff --check
```

人工检查：

- 六层叠放、展开、重组、单层查看和合成查看。
- 两图、三图、四图、六图、九图、十图容器布局。
- 单选、多选、HUD、输入区“将基于”、连接头和交叉线。
- 长 Agent 工具时间线、Prompt 折叠块、最小工作宽度。
- 退出后的唯一登录界面。

## 完成门槛

- 自动报告的功能、状态、手势、视觉、证据五层全部通过。
- 每份关键报告通过独立 evidence audit。
- 人工关键截图与自动报告一致，没有真实遮挡、暗化、裁切或错位。
- 非视觉自测、TypeScript、构建和 diff 检查通过。
- 只有达到以上门槛才关闭旧 Goal，并创建《持续产品硬化总 Goal》对应的新活动 Goal。

## 本轮最终结果

旧 Goal 已达到上述门槛：

- Layer Stack：`.diagnostics/electron/aidebug-2026-07-12T21-57-42-960Z/report.json`，7 个真实场景，0 failure；独立 audit 0 error / 0 warning。
- Agent / Selection / Connections：`.diagnostics/electron/aidebug-2026-07-12T21-59-51-594Z/report.json`，20 个真实场景，0 failure；独立 audit 0 / 0。
- Image Collection / Gestures：`.diagnostics/electron/aidebug-2026-07-12T21-55-13-975Z/report.json`，8 个真实场景，0 failure；独立 audit 0 / 0。
- Auth Gate：`.diagnostics/electron/aidebug-2026-07-12T21-57-48-165Z/report.json`，8 个真实场景，0 failure；独立 audit 0 / 0。
- Prompt / FastMemory UI：`.diagnostics/electron/agent-text-ui-2026-07-12T22-03-21-608Z/report.json`，全部断言通过。
- `test:agent-text`、`test:image-layout`、`test:psd-export`、严格 TypeScript、Node 语法、正式构建、evidence auditor 自测和 `git diff --check` 全部通过。

新增的真实证据包括：跨容器 DOM 拖放、源容器降级和目标顺序；标准单图拖动前/中/释放/稳定四态；分层合并普通图的真实移动与归组且原六层不变；障碍节点覆盖线路但路径不变；交叉线按创建顺序绘制和像素层级；Auth 刷新后新文档稳定证据。
