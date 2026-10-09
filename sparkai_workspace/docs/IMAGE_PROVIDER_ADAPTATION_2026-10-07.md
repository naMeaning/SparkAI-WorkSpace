# 在现有图片接口上适配供应商

## 现有完整链与保留边界

现有手动生图弹窗收集 Prompt、模型和素材，`src/main.tsx` 通过 `window.naimageServer.generateImage` 调用 preload 的 `naimage:server:generate-image`；`desktop/ipc/server-ipc.cjs` 检查项目/会话并管理 run、取消、预览和成果提交。`ProjectAgentComposer` 则走既有 Agent IPC/runtime，`image_gen` 执行同样复用 Main 的 `callNewApiImageWithSession`。两个入口的生产图片请求都进入已有 `desktop/image-generation-service.cjs`，归一化输入，解析当前连接，再通过 `runtime/image-generation/adapters.cjs` 构建请求。现有 `desktop/new-api-client.cjs` 保留逐模型 URL/Key、账户密钥、认证、同步 JSON/multipart、异步 create/poll 和错误边界。图片响应归一化后保留旧 `data[]` 兼容输出；Main 原有提取、下载、格式复核、项目落盘和 Renderer 成果展示继续使用。

保留页面、Prompt、项目素材上传、逐模型凭据 owner、账户流程、NewAPI/Sub2API 传输、异步任务与未知创建不重试规则、图像蒙版兼容、项目文件/成果/画布关系。没有新增 HTTP 生图 Route 或第二套工作台。

## 发现与最小改动

| 位置 | 原问题 | 改动 |
| --- | --- | --- |
| `runtime/image-generation/types.cjs` | known/inferred 模型覆盖显式 protocol；URL 提示覆盖 gateway | connection binding > legacy model config > 自动默认；protocol、gateway、transport 独立，模型 ID 原样保留 |
| `runtime/image-generation/adapters.cjs` | xAI 编辑发 multipart；所有格式依赖 service 统一解析 | xAI JSON image/images；既有三个 Adapter 复用统一解析入口，未来可独立提供 normalizeResponse |
| `desktop/image-generation-service.cjs` | 远程输入被直接拒绝；图片 MIME 可能默认为 PNG | 使用既有公网安全下载 owner、输入字节限制和实际编码识别；原本地/内联输入保留 |
| `desktop/new-api-client.cjs` | BaseURL `/v1beta` + endpoint `/v1beta/...` 拼成 `/v1betaa/...` | 统一版本前缀拼接，保留 BaseURL 中用户配置的路径前缀 |
| `desktop/ipc/server-ipc.cjs` | 手动请求中已有 ratio/resolution 被 IPC 丢弃 | 透传统一规格到原图片服务 |
| `src/model-config-dialog.tsx` / `src/core.ts` / Main 配置镜像 | 无法明确选择同一模型所用渠道接口 | 复用逐模型连接，增加接口格式、服务渠道、结果获取；`auto` 保持自动默认并可覆盖旧显式配置 |
| `src/main.tsx` 设置关闭 guard | 点击模型连接下拉的 portal 被误判为外部点击，关闭设置 | 复用 MenuSurface 的 data-ui-menu-surface 标识，并对齐 model-picker-dialog 表面类名 |

模型、供应商标签、Adapter、渠道、BaseURL、Key 分别保留。以逐模型 connection binding 的 protocol/gateway/transport 为明确连接配置；旧 imageModelConfigs 为回退，不改变凭据存储或暴露完整 Key。选择同一 Grok 模型时，官方渠道可以使用 xai-images，支持兼容格式的中转站可以使用 openai-images；Gemini 和不含供应商名称的渠道别名同样可显式指定 Adapter。模型名称推断仅用于没有显式配置或选 auto 时的旧配置默认值。

| Adapter | 生成/编辑输入 | 返回处理 |
| --- | --- | --- |
| OpenAI Compatible（既有） | `/v1/images/generations` JSON；`/v1/images/edits` multipart | 保留 URL/base64 与旧 data[] |
| xAI 原生 | `/v1/images/generations` JSON；`/v1/images/edits` JSON image 或 images，最多 5 张；专有 aspect_ratio/resolution/quality；统一 high/standard 映射官方 medium，auto 不发送 | URL/base64 统一图片项 |
| Gemini 原生（现有 generateContent 模型） | `/v1beta/models/{model}:generateContent`；contents/inlineData/generationConfig | candidates/content/parts/inlineData（含 snake_case 兼容）；忽略 thought 图片 |
| NewAPI/Sub2API | 渠道和传输设置；与上方 Adapter 可独立组合 | 保留现有同步、异步包装和结果恢复 |

Google 最新图片指南目前还包含 Interactions API 的新模型示例；本次保留并适配当前项目已有 generateContent 模型，不把未接入的新端点冒充已支持。后续新协议可在原 Adapter 注册表补 buildRequest/normalizeResponse 和配置选项，无需另写前端请求链。

## 最终本地验证

- `test:image-generation-adapters`、`test:image-generation-service`、`test:custom-api-transport`（40 cases）、`test:settings-persistence`（127）、`test:settings-secret-store`、`test:settings-lazy-load`（67）、typecheck 均通过；既有异步/IPC/遮罩及远程下载安全专项在本轮也通过。
- `aidebug:canvas-materials`：`.diagnostics/electron/canvas-materials-2026-10-07T04-41-50-994Z/report.json`，12 checks/9 screenshots/0 真实模型请求。真实 Electron 鼠标操作将同一 Grok 模型配置为 OpenAI Compatible + NewAPI，并将 Gemini 三项改为 auto；Main JSON 保存和 Renderer reload 均保持，设置下拉不再误关。
- `aidebug:gui`：`.diagnostics/electron/aidebug-2026-10-07T04-43-35-350Z/report.json`，quick-smoke 通过。`corepack pnpm run build` 退出 0（1676 modules、22.07s）。

源码验收后，用户追加要求打包 EXE；两种 1.0.9 x64 开发安装包已生成并通过各自实际程序素材/供应商保存与 reload、主题/账户/独立窗口和安装器 UI 检查。每个程序报告 18 截图，每个安装器报告 19 截图；包内 Main/Adapter/新 UI 等 12 文件分别匹配源码或当时 dist，策略正确。文件大小、MZ、SHA-256、NotSigned 与报告汇总在 `.diagnostics/release/image-adaptation-delivery-2026-10-07.json`。

未进行真实 provider/各中转站联调、完整实际安装/卸载、签名或正式发布。完整素材验收和失败迭代记录见 `PROGRESS.md`。

## Grok 已消费但 AggregateError 的回归（2026-10-07）

实际安装版在 14:14:29、14:16:38（Asia/Shanghai）记录 Grok generations HTTP 200、xai-images/newapi 各识别 1 张图片；会话随后失败且没有成果成功日志。xAI 官方默认返回临时 URL，旧 Adapter 没有指定 response_format，Main 还需要直连下载 CDN 图片。历史仅保存 AggregateError，底层网络细项已丢失，不能将离线夹具中的 ETIMEDOUT/ENETUNREACH 冒充实际网络原因。

离线复现记录 `.diagnostics/grok-result-download-2026-10-07/before.json` 证明 native HTTP 的空 message AggregateError 在 Agent 重建 Error 后会丢失 code/cause，最终落入 unknown/retriable=true。修正沿用既有 Adapter 默认请求 b64_json，明确指定 url 时仍支持原路径；Main 下载失败使用现有 errors owner 生成安全摘要，不公开签名 URL/私有 socket。单张、多 items 与 mask 结果路径保留“已生成、不可重生成”标记，当前 chat turn 阻止模型修改参数后再次 image_gen。没有给前端增加另一套请求逻辑或修改中转后台。

新增 `test:image-result-download` 在隔离真实 Electron 中运行已有 service → Main 写入链：Base64 无 CDN 请求即可生成受管文件，公网 URL 原路径仍能写入，空 AggregateError 的下载失败返回明确分类且不重建生成请求；网络和图片接口全部 Mock。具体结果、build 与修订 EXE 记录见 PROGRESS。

## 真实 Grok 中转复验与编码修复（2026-10-07）

用户重新明确授权 supeai.top 的真实测试后，本轮发出两次 n=1 POST、0 自动创建重试。首个请求 19,365 ms、HTTP 200，返回有效 JPEG Base64；Main 按默认 PNG 校验，失败为 NAIMAGE_IMAGE_OUTPUT_FORMAT_MISMATCH。该次探针仅记录脱敏结构，漏存图片字节；第二次作为明确的修订验证请求执行。

历史修复（superseded，2026-10-08）：曾经通过 Adapter.outputFormatControl 与 Main 本地转换按请求格式交付。用户新要求替代该决定；已返回图片的处理失败禁止重生成与 advice 保留。

第二个真实请求 21,984 ms、HTTP 200，返回 175,415 B JPEG；实际 Electron 保存 803,210 B、1024×1024 PNG，解码像素逐字节一致。在线报告、供应商原图、受管成果与像素校验在 `.diagnostics/electron/grok-live-2026-10-07T15-48-10-078Z/`。本轮真实测试只证明该地址/密钥下的 Grok 单张文生图；Grok 编辑、其他真实供应商/渠道和真实账户未由此验证。修订 EXE 状态见最新 PROGRESS。

## 用户更新：直接保存供应商原格式（2026-10-08，verified）

沿原 service → Adapter → transport → Main 链路，结果按真实 PNG/JPEG/WebP 字节保存，不转码或因请求与返回编码不同而拒绝有效图片。移除仅供转码的 Adapter 属性和落盘协议上下文，模型/供应商/协议/渠道配置仍互相独立。Main 的扩展名、MIME、outputFormat 和 generation.response.outputFormat 均取真实格式；generation.request 仍记录原始请求偏好。WebP 只完整解码到 raw 进行验证，文件字节不重编码；主动导出仍由原离线导出服务处理。

验收使用原 test:image-result-download 的三 Adapter × 三格式字节一致性、无效/超限图片与下载错误分类；用户授权一张真实 Grok 哆啦A梦，探针禁止第二次创建并比对原图/受管结果。packaged-smoke 的 material-image 现支持真实 JPEG/PNG/WebP，用这张真图验证生产程序显示/素材/读回，0 新真实模型请求。实际证据与开发 EXE 状态见最新 PROGRESS。

真实哆啦A梦请求一次 n=1、HTTP 200/20,253 ms，原始 JPEG 1024×1024/172,830 B 与 Main 文件逐字节相同；报告 .diagnostics/electron/grok-live-2026-10-08T04-59-15-321Z/report.json。Agent 旧 direct fallback 同步放开请求/实际格式差异，test:image-format 通过真实 runTool Mock 三格式验证（尺寸符合既有交付画幅合同）。两种修订开发 EXE 构建、各实际程序 JPEG 保存/导入/素材显示与配置 reload、每包 6 文件比对、MZ/哈希/NotSigned 全通过，各 16 截图、0 新模型请求；汇总 .diagnostics/release/grok-doraemon-delivery-2026-10-08.json。真实账户继续 deferred，其他真实供应商与 Grok 编辑未验证。

## 只读参考（2026-10-07 获取）

- [Open WebUI images.py](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/images.py)：独立 image engine 与后端连接设置，生成/编辑服务返回统一可展示成果；只参考抽象，不复制实现。
- [xAI 图片生成](https://docs.x.ai/developers/model-capabilities/images/generation)
- [xAI 图片编辑](https://docs.x.ai/developers/model-capabilities/images/editing)
- [xAI 多图片编辑](https://docs.x.ai/developers/model-capabilities/images/multi-image-editing)
- [Google generateContent API](https://ai.google.dev/api/generate-content)
- [Google 图片生成指南](https://ai.google.dev/gemini-api/docs/image-generation)

原始只读页面与代码快照位于 `.diagnostics/provider-docs-2026-10-07/`。此前未授权阶段只有本地合同证据；最新授权的 Grok 在线验证见上节，不能推广为全部供应商/渠道已实测。
