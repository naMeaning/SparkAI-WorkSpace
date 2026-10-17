# 工作台优化实施与本地验收（2026-10-17）

依据[优化设计](WORKSPACE_OPTIMIZATION_DESIGN_2026-10-16.md)第12节实施。起点为main / `15a126bd73b0852236e8d8768030de81a5de8e3f`；保留接受时已有设计、Goal、Progress和地图文档。本文记录本轮实际证据，当前交付状态由[Progress](../PROGRESS.md)顶部维护。

本轮全部模型链路均使用本地HTTP模拟，新增真实图片、视频、对话模型请求为0。未修改Extension、外部New API或生产配置，未安装依赖，未上传EXE、打tag或发布Release。真实OpenAI/xAI/Gemini/Sub2API/Extension/Seedance合同与计费未新增验证；Grok渠道仍未恢复。

## 阶段0：现场与基线

- 已恢复根/桌面AGENTS、Goal、Progress、产品意图、决策和相关地图，并对照实际源码。
- 先复现运行证据按provider传播的问题，再收敛至Main冻结的精确连接身份。
- 标准三轮基线与100/500/1000真实2K/4K PNG/JPEG/WebP混合夹具均保留；纠正旧测试的左键“平移”及不合法受管资产目录，不拿无效夹具对比最终性能。
- 每轮使用隔离的冷应用缓存，共享机器磁盘缓存；同机器1280×720、DPR1、暗色、前台调度，Node24.19.0 / Electron42.6.1。混合素材以hard link建立不同受管路径，字节、解码尺寸和资产身份不变，500条消息，999条hub关系和实际Ctrl+A纳入1000节点测量。

## 阶段1：接口、身份与证据

- 复用`modelAccessProfiles`，连接身份来自归一化真实URL和实际解析凭据的内部指纹；请求在解析凭据后冻结身份，在途切换不会改变回写对象。
- schema v2观察按连接、原始模型ID、Adapter、传输、操作、参数范围、阶段和时间限定；历史无身份证明的成功降为历史，最近失败不被旧成功掩盖。上游响应与受管成果交付分别记录。
- Main解析脱敏连接摘要，Base URL和凭据独立继承；普通设置读取缓存。旧连接一次迁移保留原有效出口，新配置不凭域名猜异步；不支持的协议/传输/参数组合派发前拒绝。
- 纯策略/本地协议专项已通过：`test:model-runtime-evidence`、`test:model-catalog`、`test:custom-api-transport`、`test:image-generation-adapters`、`test:image-generation-service`、`test:image-generation-async`和`test:model-ux`。明确验证HTTP method/path、JSON/multipart、认证、原始模型ID、轮询/空结果及敏感信息边界。
- [本地双连接Electron报告](../.diagnostics/image-generation-failure-ui-2026-10-17T02-51-57-607Z/report.json)通过：两Key目录隔离，A失败只记A，B不补模型或观察；1次图片POST/3轮Agent模拟，错误可见且脱敏。

## 阶段2：画布行为

- 单一selection reducer继续拥有主项和集合。空白轻点/空框保留选择，中键与Space在作品表面临时平移；左键选择工具框选。约5 CSS px后进入拖动，预览与最终一次mutation分离，Escape/pointercancel/失焦回滚。
- 框选使用canonical世界几何及rAF预览，能选未挂载节点。右键冻结目标、槽位资产、项目及revision；未选B的菜单只操作B并保留原集合，过期目标拒绝。关系菜单保留单边身份。
- 连接头轻点/空白松手/Escape/pointercancel不建边；实际拖放建边可单次撤销。resize取消/提交、慢双击、Ctrl增减与Agent SOURCE、容器槽位、重载资产/节点身份均有真实Electron断言。
- [100%](../.diagnostics/workspace-optimization-ui-2026-10-17T06-15-15-494Z/report.json)、[125%](../.diagnostics/workspace-optimization-ui-2026-10-17T06-16-11-433Z/report.json)、[150%](../.diagnostics/workspace-optimization-ui-2026-10-17T06-10-19-345Z/report.json)各28项/8截图通过；150%截图核对双端均未挂载时穿视口关系仍可见。新增夹具以目标viewport避免既有nudge夹紧，并检查坐标与还原，不为测试改变产品坐标合同。
- [原生Windows失焦证据](../.diagnostics/workspace-optimization-ui-2026-10-17T04-17-22-798Z/report.json)通过：正常激活隔离Electron后切到Chrome，收到可信blur，拖动坐标/选择回滚。纯几何专项`test:requirement-graph`另有3000组确定性采样/356组含可见点无漏线，不能代替上述可见UI证据。
- 旧项目缺createdAt时的重复身份已修复：Main/Renderer均以原始createdAt（缺失为空）生成legacy origin，展示补日期不进入持久身份；实际重载严格保留5节点。

## 阶段3：失败分类与原任务恢复

- Main项目journal在派发前记录operation/slot/冻结连接，accepted立即记taskId。统一图片服务传递accepted/status，结果按operationId+requestIndex幂等发布，图片操作和项目保存revision协调。
- 恢复仅查询原taskId、取回原结果或处理/保存已缓存二进制；未知创建结果不重POST。凭据变化拒绝用新连接查询旧任务。取消本地等待不宣称上游取消。
- journal不存Key/Cookie/签名URL/base64；失败结果二进制暂存保留真实格式，遮罩处理失败仍记录未处理状态，不把失败输出当最终成果。
- `image.operations` / `image.recover`已同步GUI、共享schema/registry/runtime、preload/IPC、CLI/MCP文档及契约，CLI实际调用纳入重启测试。
- [服务10子进程恢复](../.diagnostics/image-recovery-x6Rh9i/report.json)通过：1POST/3poll/2download，包含凭据改变、查询/下载暂时错误、写盘失败、原结果缓存、跨进程遮罩恢复和像素核验。
- [应用5次启动最终复验](../.diagnostics/image-recovery-ui-2026-10-17T06-04-38-834Z/report.json)通过：8本地POST/6poll；4xx/429/502/断连/缺taskId不重放，部分成功保留；受理后取消再重启查询原task，重复恢复不增加节点；真实session写失败可见，列表刷新显示本地成果待恢复，重复保存不增加POST/poll。第二次重启身份稳定。

## 阶段4：布局、工具与配置

- Agent偏好宽度与窗口临时夹紧分离，小窗保留画布；折叠、停靠和独立窗仍投影同一个Runtime。底部常用工具+全部工具搜索复用原registry/MenuSurface、领域分组和recent持久化。
- 图片配置展示手动默认与Agent有效模型政策、比例/分辨率/数量/质量，Main/Renderer复用共享模型策略。图片偏好串行自动保存并显示失败/重试，连接仍为草稿保存/取消；关闭/Escape不吞保存失败，普通打开不触发目录GET。
- [100%布局配置](../.diagnostics/workspace-layout-config-2026-10-17T03-45-17-007Z/report.json)、[125%](../.diagnostics/workspace-layout-config-2026-10-17T04-18-55-790Z/report.json)、[150%](../.diagnostics/workspace-layout-config-2026-10-17T04-19-38-054Z/report.json)均通过；每组2次启动/7截图/12项，0模型POST/0目录GET。
- 884×640实际画布472px/Agent348px，扩大后恢复650px偏好；1280×820与大窗检查输入、工具、长标题、菜单首尾与键盘命中。150%最大实际1708×934，受显示器工作区约束，未声称该DPI下1920×1080已验证。`aidebug:gui` quick smoke因旧350–430px Agent断言首次失败后，测试改为现有320–720px偏好合同并要求画布≥463px，第二次六场景通过：`.diagnostics/electron/aidebug-2026-10-17T06-13-13-434Z/report.json`。
- 保存失败、快速连续修改、关闭保护、本地重试、重启读回5张/3:2、主/独立Agent同源已实测。quick GUI旧350–430px断言已同步实际320–720px偏好合同并追加画布最低宽度断言，复验结果见后续交付记录。

## 阶段5：测量、优化与未达项

最终候选性能Renderer bundle SHA-256为`020daad12aa2ea8d32bd17ce65be90cb326aef092465ec6cf4a494f9a8880499`。完整[前后汇总](../.diagnostics/workspace-optimization-performance-comparison.json)保留每轮原始报告，排除注入CSS/强制合成层等试验。

| 同条件场景 | 就绪ms，前→后 | 缩放视觉P95 ms，前→后 | 平移视觉P95 ms，前→后 | 拖动视觉P95 ms，前→后 |
| --- | --- | --- | --- | --- |
| 标准三轮 | 3353→2889 | 71.5→78.0 | 37.0→40.0 | 82.0→92.9 |
| 混合100（各1轮，6轮内存） | 8850→6723 | 58.7→82.6 | 109.8→16.6 | 130.1→45.6 |
| 混合500（各1轮） | 35903→12651 | 240.1→226.0 | 651.8→62.3 | 397.6→499.5 |
| 混合1000（三轮） | 72687→26071 | 1026.9→353.0 | 1706.3→66.5 | 477.0→816.1 |

- 标准三轮原门禁通过：boot1969.3ms、JS heap15,126,276B、操作long task0ms、慢帧12.5%。原门禁通过不等于33.4ms建议目标达成。
- 混合1000选择仍为1000项，初始DOM9，交互后DOM197/轻量概览196/挂载关系285，canonical999条关系未删。去除屏外次选和关系对远端节点的强挂，低缩放次选复用概览并保留高亮，播放中的视频保持完整；关系与实际Bezier同源裁剪，不能漏掉双端屏外穿视口线。
- Main hydration剖析定位同一受管根反复realpath；改为同步单次hydrate/save复用根、逐文件仍fresh lstat/realpath、下次操作重新验证。独立2000节点诊断hydrate19,346.8→8051.1ms、save13,283.6→5284.3ms，前测带CPU profiler，数字只作定位辅助，不当严格门禁；junction替换到项目外后的下一操作拒绝与session merge87项通过。
- 工具条ResizeObserver按稳定command身份订阅，去除每帧children引用触发的同步layout。已撤回无收益的有界SVG绘制面、资产stream与强制合成层试验；不以隐藏关系、改阈值或筛掉失败轮次制造通过。
- [12轮内存](../.diagnostics/electron/product-performance-2026-10-17T06-02-18-194Z/report.json)实际切项目/开原图查看器/交互：GC后JS6.92→7.69MiB，第7–12轮7.45–7.69MiB；8进程树private第7–12轮933.16–983.54MiB、末轮936.36MiB，Working Set约834–853MiB。有限循环内趋平台，不能承诺无限运行无泄漏。
- [本地有效WebM播放](../.diagnostics/electron/product-performance-2026-10-17T06-00-54-049Z/report.json)行为断言通过：640×360/2秒，帧5→59，交互后时间1.430818s/paused=false，与21条Mock进度共存；暂停/切项目不恢复播放。该报告因混合场景启动等预算仍为ok:false，不把播放通过写成完整性能通过。
- **未达：500/1000密集拖动P95回归；标准和混合场景未达到33.4ms建议目标，混合场景启动/视觉等原预算也未全过。** 加载、平移和多数中位帧改善不抵消这些失败。阶段5保持部分验证，不宣称全部优化目标完成。
- 开发态`test:bundle`实测initial JS4,133B、plugin JS86,177B符合硬限；CSS281,539B超过正式270,000B硬限11,539B；core async JS1,327,603B、core JS1,331,736B、dist1,763,981B超过趋势advisory。命令退出1；依AGENTS允许的开发包继续，不视为正式候选通过，也未机械拆分。

## 最终交付记录

首次unrestricted候选 `release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`（109,858,304 B，SHA-256 `7c2dc05a45d204bb097354f794816fdfe1c504ca50b115a94c5c474501b39657`）已安装，安装器退出码0、既有配置3项保留；安装后UI复测发现884×640窗口的画布/Agent高度约18,081px，见[150%失败报告](../.diagnostics/workspace-layout-config-2026-10-17T06-28-25-328Z/report.json)和[100%失败报告](../.diagnostics/workspace-layout-config-2026-10-17T06-35-34-399Z/report.json)。该EXE已被标记为失败候选，不作为本轮交付制品。原因是`src/styles/06-responsive.css`的900px窄屏断点覆盖了产品正式最小宽度884px；断点现已收至883px，`test:production-symbol-compaction`通过883/884px生产CSS保留边界。修复后[开发Electron布局/配置专项](../.diagnostics/workspace-layout-config-2026-10-17T06-49-35-476Z/report.json)通过，884px下画布472px、Agent348px，无溢出，工具搜索、保存失败重试和重启读回通过，0模型POST/目录GET。

最终修复包已通过`package:win:unrestricted`、包内审计并完成原位安装，完整机器可读摘要见[最终安装记录](../.diagnostics/workspace-optimization-install-final.json)。EXE `release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`为109,854,720 B，SHA-256 `b9f42418f252f8a02235b772d685b40e64f17ca3508ee0b31aedb0c7546634b0`；123个dist文件、17个Main/runtime owner及dual-access策略核验通过。安装器`/S`退出码0/24,009ms；注册版本1.0.9，已安装主程序`E:\sparkai-workspace\naimage\SparkAIWorkSpace.exe`为232,754,176 B / SHA-256 `606264f3f14eaf409f997a9cbd8db5d8c02d687164b08f2e9c8e6fb4a6e22343`，安装ASAR与候选一致。设置、项目列表与密钥sidecar保留，未读取凭据内容。

安装版UI复验：[150% DPI布局/配置](../.diagnostics/workspace-layout-config-2026-10-17T07-06-19-398Z/report.json)两次启动、12项、7截图通过，884×640画布472px/Agent348px无溢出，保存失败重试、重启读回、工具搜索及主/独立Agent配置同步通过，0模型POST/目录GET；[本地双连接故障模拟](../.diagnostics/image-generation-failure-ui-2026-10-17T07-08-08-080Z/report.json)1次图片POST/3轮Agent模拟通过，A连接502未传播到B，0真实模型请求。

交付状态为本地开发包，未上传EXE或发布Release。阶段5仍部分验证：500/1000节点拖动视觉P95回归，33.4ms目标未达；正式`test:bundle` CSS 281,539 B，超过270,000 B门槛11,539 B。真实供应商协议与模型服务未验证，150% DPI最大实际窗口为1708×934，未覆盖1920×1080；这些限制没有因打包/安装通过而改变。源码/文档commit `9c8967f5ed069c71d8d1565721827ff762b98989`已普通push，远端`origin/main`已核对为相同commit。生成诊断、安装包和私有配置继续忽略，不进入Git。
