# Round 1：原生 Agent、真实观测与生产性能基础

更新时间：2026-07-12

## 本轮目标

修复三个会让后续优化失真的底层问题：

1. Agent 工具结果不能被外层终止或写死收尾，必须回到模型形成原生工具循环。
2. AIDebug 不能伪造窗口尺寸或只测 DOM，必须形成可复跑的真实性能基线。
3. 测试控制面和废弃大资源不能继续进入正式包。

本轮完成后，再推进 Image Gen Schema/上下文、UI Surface、Renderer 和项目 I/O。

## 已完成

### Agent 原生工具循环

- 只有 `ask_user` 是等待态。
- `view_image`、`shell_command`、`experience`、`workflow`、`image_gen` 按 Responses `function_call_output` 返回模型，`web_search` 使用原生 `web_search_call`；模型决定下一步和最终正文。
- 删除图片工具硬编码完成回复、synthetic user 修正消息和 `nextInstruction`。
- 保留 8 轮、并发、数量与精确重复哈希等安全硬门；不同参数的合法连续调用不被误杀。
- 自测覆盖 `view_image → image_gen → final`、`web_search → image_gen → final`、`experience → image_gen → final`、失败回灌和精确重复。

### AIDebug 窗口与性能真实性

- size 未请求时记录 `not-requested`，不再把 renderer actual 回填成 requested。
- 请求、BrowserWindow、renderer inner/outer、DPR、截图尺寸/hash 和容差分别记录。
- Browser bounds 不可获得时保留错误和 unknown，不伪造绿色结论。
- `pnpm run aidebug:performance` 覆盖冷启动、200 节点、10 图容器、pan/zoom/drag rAF、Long Task、heap 和保存。
- 首份性能报告：`.diagnostics/electron/aidebug-2026-07-12T22-23-00-639Z/report.json`，独立 audit 全绿。

### 正式包隔离

- Vite serve 保留 AIDebug；正式 build 以 compile-time flag 移除整段测试控制面。
- 正式 JS 从 752,240 bytes 降至 604,025 bytes。
- `dist` 不再复制 138 个无产品入口的风格库资源，从约 33.39 MB 降至 864,339 bytes。
- `pnpm run test:bundle` 验证 JS/CSS/dist 预算、正式图标和调试标识泄漏。
- 开发态 Prompt/FastMemory GUI 自测通过，证明测试 hook 仍存在。

## 正在实施

### Image Gen 与大画布上下文

- placeholder 无损过滤与单图/批量降级。
- 容器 `assetIndex` 与参考图 `role/purpose`。
- 500 节点动态上下文预算、选中节点优先和成果分页查询。

### UI Surface 第一批迁移

- 建立 `DialogShell`、Header/Body/Footer、ActionButton 和稳定 `data-ui-surface`。
- 先迁移确认框、Prompt/FastMemory 编辑器；模型弹窗只在能完整闭环时迁移。
- 新专项覆盖 1280、884×720、884×640、长 Prompt、焦点、Escape、backdrop、dirty/busy。

## 下一步性能目标

当前基线中优先优化：

- 200 节点 hydrate：354.3 ms。
- zoom p95：34.7 ms。
- 单次 Long Task：128 ms。
- 该场景 JS heap 增量：约 24.36 MB。
- 正式 JS 仍为 604 KB，超过理想的 500 KB；下一步通过 Renderer/Symbol 拆分和按需加载继续降低。

任何优化必须与当前性能报告同口径复测，不能用不同 fixture 或不同窗口冒充提升。

## 本轮最终合并验证

- Agent 原生循环、Image Gen 容错、assetIndex/role/purpose、500 节点上下文与分页全部进入 `test:agent-text` 并全绿。
- UI Surface 专项最终 93 项检查、0 失败：`.diagnostics/electron/agent-text-ui-2026-07-12T22-52-25-299Z/report.json`。
- Project I/O：322 个有效资产恢复扫描 0 次，1 个缺失资产扫描 1 次；revision、跨项目队列、manifest v1/v2 迁移全绿。
- 合并后 Agent-only：`.diagnostics/electron/aidebug-2026-07-12T22-53-29-583Z/report.json`，20 场景，独立 audit 0 / 0。
- 合并后 Auth：`.diagnostics/electron/aidebug-2026-07-12T22-55-53-260Z/report.json`，8 场景，独立 audit 0 / 0。
- 第二份性能基线：`.diagnostics/electron/aidebug-2026-07-12T22-57-13-511Z/report.json`，200 节点 193.1 ms、10 图 50.7 ms、pan p95 14.2 ms、zoom p95 27.8 ms、drag p95 14 ms、Long Task 62 ms；heap 增量约 37.84 MB，仍需专项治理。
- 正式包合并后：JS 608,680 bytes、CSS 215,295 bytes、完整 dist 874,564 bytes，调试标识零泄漏。
