# 性能真实性与缩略图闭环计划

更新时间：2026-07-13

## 一、本轮结论

现有性能报告能够证明开发态 AIDebug 环境中完成了 200 节点 hydrate、10 图容器、pan/zoom/drag、Long Task、JS heap 和一次 session 保存测量，但不能证明生产用户环境已经达到可交付性能。

当前权威基线 `.diagnostics/electron/aidebug-2026-07-12T22-57-13-511Z/report.json` 的主要数据：

- 200 节点 hydrate 193.1ms，实际挂载 57 个节点。
- pan p95 14.2ms，drag p95 14ms，zoom p95 27.8ms。
- Long Task 1 次，最大 62ms。
- JS heap 增量约 37.84MiB。
- 10 图容器 50.7ms，但素材是内嵌 data URL PNG，不经过项目协议、磁盘原图、缩略图缓存或真实 4K 解码。
- 保存场景在清空 200 节点后执行，`payloadNodeCount=1`，不能证明大项目 session 写入健康。

因此，本轮不把旧报告的 `evidenceQuality.complete` 等同于“性能完成”。它只代表 schema v1 的字段齐全。

## 二、已经落实的缩略图核心

新增独立模块：

- `thumbnail-cache.cjs`
- `image-thumbnail-worker.cjs`
- `scripts/thumbnail-cache-selftest.cjs`

固定契约：

- 默认长边 512px，保持宽高比，不放大小图。
- 输出 WebP；PNG/WebP 的透明通道继续保留。
- 缓存键包含规范化源路径、文件大小、mtime、maxEdge 和格式版本。
- 同一缓存键共享 Promise；不同键进入全局有限并发队列，默认 2、硬上限 4，避免大画布同时 fork 数十个 sharp 进程。
- sharp 仅存在于独立子进程；主进程缓存层不解码大图。
- 临时文件使用 `*.thumb-<pid>.tmp`，完成后原子 rename；失败、超时、关闭和异常退出均清理 staging。
- `close()` 会拒绝排队任务并终止活动 worker。

自测覆盖 3840×2160 PNG/JPEG/WebP、透明 alpha、512×288 输出、缓存命中、mtime 失效、10 个同源并发只启动 1 个 worker、6 个异源并发最多 2 个 worker、损坏输入与临时文件清理。

## 三、性能真实性契约 v2

下一版 performance report 必须区分：

1. `development`：允许完整 AIDebug，用于定位问题。
2. `production-like`：正式 renderer bundle，仅启用最小只读 performance bridge；不得携带完整 `__iiimageAIDebug` 控制面。

两种 profile 使用同一 fixture、窗口、DPR、素材和采样次数。结论至少采用三轮中位数，并保留每轮原始值，不能用单次最好成绩。

### 大画布

- 200 节点用于日常回归。
- 1000 节点用于投影、选择、fit canvas 和关系线压力。
- 分别记录运行时节点数、挂载 DOM 数、可见节点数、投影耗时和 Canvas 分区 React commit 次数。
- 验证末尾被选中的节点不会因投影或上下文预算消失。

### 图片与缩略图

- 使用真实 4K PNG/JPEG/透明 WebP 项目资产，不使用 data URL 替代。
- 冷缓存：记录请求数、原图字节、缩略图字节、worker 最大并发、生成耗时和图片 load/decode 完成时间。
- 热缓存：记录 cache hit、协议请求、解码数和再次进入视口时间。
- 对照原图直载与缩略图加载，证明传输/解码字节显著下降；查看器和导出仍必须使用原图。
- 画布快速 pan/zoom 时离屏请求应可取消或不再进入高优先队列。

### Renderer 分区提交

分别记录以下区域的 commit 次数与总耗时：

- Canvas 节点与线路层。
- Agent 消息时间线。
- Composer、当前选中和参考图区域。

验证流式 delta 只更新当前消息，节点拖动只更新画布相关分区，图片进度不会触发整个工作台重复提交。

### 长时间线

- 500 条已完成消息。
- 单条 1000 次流式 delta。
- 50 次工具开始/完成事件。
- 记录 Agent feed commit、DOM 消息数、滚动跟随、输入延迟、Long Task 和清理后的 retained heap。

### 持久化

- 200 与 1000 节点 session。
- 记录 payload bytes、请求次数、实际磁盘写入次数、合并写入次数、flush 耗时和 revision。
- 快速拖动期间不得每帧整份 session 双写；切换项目和退出前必须明确 flush。

## 四、当前测量盲区

- schema v1 只有字段存在性门槛，没有产品预算或回归阈值。
- 10 图 data URL fixture 绕过了缩略图真实链路。
- 保存 fixture 只有 1 个节点。
- 没有 1000 节点、长时间线、流式 delta、React 分区 commit 或缩略图冷热缓存对照。
- heap before/after 包含不同 fixture 状态，且没有清理后稳定采样，不能直接称为泄漏。
- 完整 AIDebug 控制面本身会增加代码、监听器和观测开销，开发态数据不能直接代表正式包。

新增 `scripts/performance-evidence-audit.mjs` 会读取最新或指定性能报告，继续接受 schema v1 作为可读基线，同时列出真实性契约 v2 的所有缺失项；使用 `--strict` 时缺失项会导致非零退出码。

## 五、下一轮完成标准

- 缩略图 bridge 接入后，普通画布节点和容器使用 thumbnail，查看器、编辑器、另存为和 PSD 使用 original。
- 冷/热缓存、4K alpha、变更失效、并发上限、缺失缓存重建均有真实 GUI 与文件证据。
- performance schema v2 同时拥有 development 和 production-like 报告。
- 1000 节点、长时间线、大项目保存和 Renderer commit 分区不再缺证。
- 所有优化与旧 Agent、容器、分层、项目隔离和生产 bundle 硬门一起回归，不以降低断言换取绿色。

## 六、首轮接线后的真实结果

最终报告：`.diagnostics/electron/aidebug-2026-07-12T23-55-48-651Z/report.json`。

功能与文件证据：

- 10 张受控 3840×2160 PNG/JPEG/透明 WebP 在画布和查看器缩略条中均使用 `preview=thumbnail&max=512`。
- 所有画布自然尺寸为 512×288；查看器主图明确使用 original。
- 冷缓存：10 requests、10 worker starts、10 generated、0 errors，最大同时 2 个 worker。
- 热缓存：27.5ms，10 requests、10 cache hits、0 worker starts、0 generated、0 errors。
- 10 个缩略图全部原子提交，staging=0；受控源文件共 488,356 bytes，缩略图共 3,602 bytes，字节比 0.00738。
- 200 节点显式 revision 保存从 2 请求到 3，appliedRevision=3，保存约 9.9ms。
- `fitCanvas` 已把顶部“大号当前选中”HUD 纳入安全区；最终截图中选中容器与 HUD 不再重叠。
- AIDebug 文件像素检查已从 PNG-only 升级为 PNG/JPEG/WebP 真实解码，没有把非 PNG 误报为损坏文件。

本轮性能观测：

- 冷启动 Electron spawn → workbench 1127ms。
- 200 节点 hydrate 281.5ms，运行时 200、挂载 57。
- pan p95 14.1ms；zoom p95 34.7ms；drag p95 20.9ms。
- 本轮 Long Task 0；JS heap 增量约 8.33MiB。
- Renderer commit 探针显示：
  - 200 节点：Canvas / Agent feed / Composer 均为 3。
  - 交互阶段：三者均为 99。
  - 10 图阶段：三者均为 8。

这组数字证明当前三块 UI 仍然共享同一根提交域；commit probe 的价值不是把它称为“分区完成”，而是把下一轮拆分目标变成了可量化问题。

独立证据：

- GUI/evidence audit：0 errors / 0 warnings。
- `scripts/performance-evidence-audit.mjs` 将该报告判定为 `baselineReadable=true`、`truthContractReady=false`。
- 仍缺 8 类强证据：1000 节点、长时间线、流式时间线、实际/合并写入次数、flush、fixture 清理后 heap、分阶段 Long Task。
- 当前 profile 明确是 `development + full AIDebug`，不能冒充 production-like。

环境解释：受控 4K fixture 是低熵纯色/透明色块，适合稳定验证像素数、格式、alpha、协议和缓存因果关系，但压缩字节不代表真实照片或复杂电商海报。后续必须增加高熵商品图 fixture，再比较解码与缓存收益。

## 七、schema v2 开发态真值闭环

本轮已经把“字段全绿”升级为多源一致性证据，不能再用单独的 `status: measured` 冒充真实通过：

- 1000 节点要求运行时 1000、199 条真实父子关系、末节点被选中、实际挂载且可见比例大于 0.9；节点 fixture 按真实节点尺寸重新留出间距，截图不允许互相覆盖。
- 500 消息要求运行时与 DOM 均为 500，工具开始/完成各 50、输入可响应、feed 实际滚到底。
- 单消息 1000 delta 使用唯一序号 token，要求 1000 次调用全部接受、最终正文 6028 字符逐字相等、状态为 done、running 数为 0。
- 10 图冷/热缩略图要求真实项目协议、10 个 4K PNG/JPEG/WebP、画布 512px thumbnail、查看器 original、冷缓存 10 次成功生成且错误数组为空、热缓存 10 次全部命中。
- 每个关键 fixture 都生成 CDP 双帧截图，并同时验证截图哈希、稳定帧、运行时/DOM、几何、横向溢出和视觉可靠性。
- 清理阶段要求节点、消息、线路、选择全部归零，随后执行 3 次 CDP GC，再记录 before/after/reclaimed/retained heap。
- Long Task 按 nodes200、interactions、nodes1000、longTimeline、streamingTimeline、imageContainer10、fixtureCleanup 七个阶段分别采集；每阶段会复核时间区间、entry 数量、总时长与最大值公式。
- Renderer commit 要求 Canvas、Agent feed、Composer 三个分区都包含上述阶段，避免只给顶层 measured。

最终权威通过报告 `.diagnostics/electron/aidebug-2026-07-13T01-26-43-018Z/report.json`：

- GUI suite：4 个场景全部通过；通用 evidence audit 为 0 errors / 0 warnings。
- 1000 节点 hydrate 490.4ms，运行时 1000、挂载 27、关系 199、末节点完整可见。
- 500 消息 318.1ms，输入观测 97.2ms，滚动尾差 0.199px。
- 1000 delta 312.6ms，最终正文 6028 字符且 exact match。
- 10 图 cold 生成 10、errors 0、recentErrors 0；warm cache hit 10。
- fixture cleanup 从 53,007,028 bytes 降至 18,570,984 bytes，本轮回收 34,436,044 bytes；相对启动基线 retained 940,492 bytes。单轮 GC 证据不等于泄漏结论。
- 仍观察到 zoom p95 34.8ms 和最长 143ms Long Task；这些保留为 warning，不以降低阈值换绿。
- 通用 GUI/evidence audit 为 0 errors / 0 warnings；严格 performance audit 仅保留 3 个持久化统计 missing，并输出 7 条真实性能 warning。

随后复跑 `.diagnostics/electron/aidebug-2026-07-13T00-54-30-089Z/report.json` 捕获到真实间歇错误：冷缓存统计 `generated=9/errors=1`，但磁盘已存在 10 个缩略图，稍后的 warm 阶段又能 10/10 命中。根因是 Windows 子进程有概率先触发 `exit`，IPC `result` 后到，主进程把已成功提交的 worker 误判失败并回退原图。修复后改用 IPC 通道关闭后的 `close` 判定，并给 thumbnail stats 增加最多 8 条 `recentErrors`（key/code/message）；严格审计明确要求 cold/warm 的 recentErrors 为空。缩略图专用自测连续 10 轮、合计 120 次 worker 启动全部通过，最大并发仍为 2。

Surface 统一迁移后，冻结复跑 `.diagnostics/electron/aidebug-2026-07-13T01-17-36-945Z/report.json` 又捕获到 AIDebug 契约漂移：图片查看器已经使用 `SurfaceHeader` 的“关闭图片查看器”，旧性能脚本仍查找 `image-viewer-actions` 内 aria-label 为“关闭”的按钮，导致模态窗口实际残留。最终统一改为 `[data-ui-surface="image-viewer"] .ui-surface-close`，并等待 Surface 真正消失；`viewerClosed` 现在直接参与 imageContainer10 的 measured 判定。

`scripts/performance-evidence-audit.test.mjs` 目前覆盖 9 个严格场景：完整 v2、浅层 measured 节点、时间线计数错误、流式正文未落地、清理残留、缺阶段、fallback 截图、缩略图 cold error 和旧 schema。开发态 evidence 即使 fixture 完整，也始终输出 `productPerformanceReady=false`。

严格性能审计仍明确保留 3 个未完成项：`persistence.writeCount`、`persistence.coalescedWriteCount`、`persistence.flushMs`。因此 `evidenceQuality.status` 使用 `fixture-complete-with-known-gaps`，不能称为完整产品性能门，也不能把 development + full AIDebug 数据包装成 production-like。

## 八、持久化真值与 Agent 时间线性能收束

上述 3 个持久化缺口已在后续报告中关闭，权威开发态报告更新为 `.diagnostics/electron/aidebug-2026-07-13T02-45-39-651Z/report.json`：

- Renderer 真实记录会触发 session 保存的状态变更、320ms 防抖计划、被取消合并的计划、实际完成的 session commit、失败/跳过和包含主进程磁盘 IPC 的往返耗时。
- 受控 200 节点场景产生 9 次保存触发，其中 8 次被防抖合并，1 次实际提交；`pendingWriteCount=0`、`failedWriteCount=0`、平均 flush 约 13.6ms。
- 严格审计不只要求字段为有限数，还要求至少一次真实提交、至少一次合并、零 pending、零失败、来源标识正确，并验证 `scheduled = committed + coalesced + pending`。
- `knownGaps=[]`、`truthContractReady=true`、通用 evidence audit 为 0 error / 0 warning；仍坚持 `productPerformanceReady=false`，因为报告环境是 development + full AIDebug，尚未声明产品阈值。

Agent 时间线也完成了真实分区优化：

- Feed 与 Composer 从同一组件拆成独立 memo 分区；1000 delta 时 Composer commit 从 50 降至 0，画布节点变化不再触发 Feed commit。
- 普通无 Markdown 语法的消息走等价纯文本快路径；真正的标题、列表、代码、链接、强调和表格仍使用 ReactMarkdown。
- 500 消息构建从约 305ms 降至约 103.5ms，输入观测从约 168ms 降至约 13.3ms；1000 delta 保持 6028 字符逐字相等、done、单消息与自动贴底。
- 画布 viewport 使用 GPU 友好的 `translate3d` 并让 stage 明确保留 transform 合成层；zoom p95 从约 34.7ms 降至约 7.1ms，pan/drag 没有回归。
- 严格性能 warning 从 9 条降至 2 条；剩余为 development baseline 无产品阈值和全套测试中最大约 104ms Long Task。不能通过提高阈值或删除观测来隐藏。

## 九、节点拖动提交域收束

最新开发态报告更新为 `.diagnostics/electron/aidebug-2026-07-13T03-42-40-552Z/report.json`：

- 根因不是 pointer 事件本身，而是普通节点拖动期间每个动画帧都调用 `setNodes`，重复重建节点投影、可见节点与关系线，35 个采样产生 39 次 Canvas commit。
- 普通节点现在在拖动帧内同步更新节点 DOM 坐标和所有受影响的来源关系线；松手时只提交一次真实节点状态。分层组继续使用原状态路径，避免破坏整组锚点、展开/重组和图层归属。
- 拖动 Canvas commit 从 39 降到 4；p50 从 13.7ms 降到 7.0ms，p95 从 34.6ms 降到 7.1ms。pan p95 7.1ms、zoom p95 7.1ms，节点最终世界坐标和屏幕坐标均发生预期变化。
- 最新 Agent-only 回归 `.diagnostics/electron/aidebug-2026-07-13T03-43-21-243Z/report.json` 覆盖 20 个真实场景，容器导入/归组、选择高亮、连线、分层 PNG、项目/会话隔离和工具时间线全部通过；独立 evidence audit 为 0 error / 0 warning。
- 严格性能审计 `truthContractReady=true`、missing=0；仍明确保持 `productPerformanceReady=false`。剩余两个 warning 是 development baseline 尚无正式产品阈值，以及全程观测到 2 个 72ms Long Task；交互阶段自身 Long Task 为 0。

## 十、production-like 产品性能门闭环

更新时间：2026-07-16

权威产品报告：`.diagnostics/electron/product-performance-2026-07-16T09-18-07-615Z/report.json`。

本轮建立了与 development baseline 分离的正式 renderer 性能门：

- 使用 performance mode 的 minified renderer，完整 AIDebug 控制面不进入 bundle；仅保留只读 `__iiimagePerformanceProbe`。
- 连续启动 3 个独立 Electron 进程，每轮装载 1000 个图片节点、199 条成果关系和 500 条会话消息。
- 500 条消息保留完整运行时数据，Agent feed 首屏只挂载最近 80 条，并支持按页查看更早消息。
- 画布尺寸未知的首帧不再错误挂载全部 1000 节点；只保留必要选中节点，真实尺寸到达后再挂载视口投影。
- 离屏关系不再创建 SVG path；只有至少一端已挂载的关系进入 DOM，完整关系数据保持不变。
- Markdown/GFM 解析器拆为按需 chunk；普通生图对话继续使用纯文本快路径。
- 粒子画布使用 ResizeObserver 的 `contentRect` 延迟初始化，不在首次工作台提交后强制全页 layout。
- Composer 使用 Chromium 原生 `field-sizing: content`，移除清零高度后读取 `scrollHeight` 的同步 reflow。
- 加载完成后不再无变化地回写 settings/session；聊天滚底由 Agent feed 单一负责，不再内外两层重复执行。

最终三轮中位数与最坏值：

- 工作台稳定可交互：1232ms；renderer boot：781.9ms。
- 正式 bundle：861,609 bytes，完整 AIDebug 标识 0 个。
- JS heap：14,260,956 bytes。
- 同步事件处理 P95：zoom 0.5ms、pan 0.1ms、drag 0.2ms。
- 可视帧 P95：zoom 115.9ms、pan 23.1ms、drag 69.3ms；三类帧中位数均约 6.9ms。
- 任一轮最坏慢帧占比 12.5%；Long Task 最大 68ms。
- 每轮均保持 1000 运行时节点、199 条关系、500 运行时消息、80 个消息 DOM 窗口、选中末节点真实挂载、零横向溢出、零保存失败和正常进程退出。

交互预算不再用单一 rAF P95 冒充全部性能：同步处理继续要求不超过 34ms；可视帧同时要求中位数不超过 34ms、超过 50ms 的慢帧占比不超过 15%、P95 不超过 150ms；Long Task 独立保持 120ms 上限。这样既保留 Windows/Electron 合成调度的尾部事实，也能阻止持续低帧率被少量快帧掩盖。

`scripts/performance-evidence-audit.mjs` 已能同时审计两种权威证据：

- development schema v2 继续是完整 AIDebug 真值基线，必须保持 `baselineOnly=true / productPerformanceReady=false`。
- product gate 必须是非 diagnostic 的正式报告，`baselineOnly=false / productPerformanceReady=true`，并复核 bundle、fixture、每轮原始样本、公式、预算、虚拟化、选择、内存、截图、持久化与退出。

严格产品审计结果：0 error、0 missing、`truthContractReady=true`、`productPerformanceReady=true`。审计自测现为 13 个场景，新增产品报告通过、diagnostic 冒充权威报告失败、帧样本与慢帧声明不一致失败三类覆盖。
