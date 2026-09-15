# NewAPI 接入基线

更新时间：2026-08-01
官方源码基线：`QuantumNous/new-api@cfaba1dd6754d4238e1360247c198a64a313e96c`

本文记录 SparkAI WorkSpace 对 NewAPI 的真实接入边界。NewAPI 是多上游、多渠道的转发层，同一路径是否可用、请求字段和返回结构都可能受版本、渠道类型、模型映射与站点配置影响，不能只根据模型名称或一段调用示例推断能力。

## 1. 鉴权与账户边界

| 用途 | 接口 | 鉴权 |
| --- | --- | --- |
| 当前用户与登录状态 | `/api/user/self` | Dashboard session |
| 用户可用分组 | `/api/user/self/groups` | Dashboard session |
| Dashboard 可见模型 | `/api/user/models` | Dashboard session |
| 定价与端点摘要 | `/api/pricing` | 通常允许匿名读取，站点可关闭 |
| Relay 模型目录 | `/v1/models` | `Authorization: Bearer <TOKEN>` |
| 对话、Responses、图片、视频 | `/v1/...` | `Authorization: Bearer <TOKEN>` |

SparkAI WorkSpace 的账号模式使用 Dashboard session 管理账户和密钥，但实际 Agent、生图、视频模型目录及后续模型调用使用用户选中的 Relay Token。分组属于 Token/渠道路由配置，不向模型 JSON 或 FormData 注入 `group`。

客户端、日志、模型缓存和项目文件均不得保存或显示完整 Token、上游 Key、session cookie。

## 2. 模型目录与能力字段

官方 `/v1/models` 的 OpenAI 格式条目包含：

```json
{
  "id": "model-id",
  "object": "model",
  "created": 1626777600,
  "owned_by": "provider",
  "supported_endpoint_types": ["openai", "image-generation"]
}
```

当前官方端点类型包括：

| 类型 | 主要接口 |
| --- | --- |
| `openai` | `/v1/chat/completions` |
| `openai-response` | `/v1/responses` |
| `openai-response-compact` | `/v1/responses/compact` |
| `anthropic` | `/v1/messages` |
| `gemini` | `/v1beta/models/{model}:generateContent` |
| `image-generation` | `/v1/images/generations`、`/v1/images/edits` |
| `openai-video` | `/v1/videos` 等视频任务接口 |

SparkAI WorkSpace 的分类规则：

1. 完整保留服务端返回的模型 ID，不因分类未知而从总目录删除。
2. 将 `supported_endpoint_types` 作为正向能力证据。
3. 对缺少或错误标注能力的实例，保留图像与视频模型名称识别。
4. 未知自定义模型继续同时出现在 Agent/生图候选中，避免静默丢失；已知端点能力则进入对应目录。
5. 模型、分类能力和分组共用 Main 进程 60 秒缓存及无凭证磁盘快照，设置页和 Agent 不重复请求。

### 已确认的实例差异

对 `https://qiuqiutoken.com` 进行了无凭证、无计费探测：

- 版本：`v1.0.0-rc.22.1`
- `enable_task: true`
- `/v1/video/generations` 路由存在，无 Token 返回 `401`
- `/api/pricing` 存在 `doubao-seedance-2-0-260128`
- 该模型当前被标记为 `supported_endpoint_types: ["openai"]`
- 全局 `supported_endpoint` 不包含 `openai-video`

官方当前源码的 `GetEndpointTypesByChannelType` 也只为 Sora 渠道显式返回 `openai-video`，没有覆盖 DoubaoVideo，因此 Seedance 被标成普通 `openai` 不是 SparkAI WorkSpace 应当盲信的事实。SparkAI WorkSpace 必须保留 Seedance/Sora/Veo 等名称回退。

## 3. 对话与 Responses

主要接口：

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/responses/compact`

推荐策略：

- 模型声明 `openai-response` 时优先使用 Responses；否则使用 Chat Completions。
- GET/HEAD 可按 `Retry-After` 重试；POST 在服务器是否已接收不明确时不得自动重发。
- 流式响应一旦收到事件，后续失败视为“可能已计费”，不能再静默回退到第二次生成。
- 记录服务器 request id、HTTP 状态、阶段和耗时，不记录请求凭证或完整敏感正文。

## 4. 图片接口

主要接口：

- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /v1/responses` + `image_generation` 工具

不同 NewAPI 版本和渠道对 `stream`、`partial_images`、JSON/FormData、返回 URL/Base64 的支持并不一致。SparkAI WorkSpace 当前策略是：

1. 生图优先请求流式中间预览。
2. 只有服务明确拒绝流式且尚未收到任何事件时，才回退一次非流式请求。
3. 收到流事件或发生不确定网络中断后不自动重发，避免重复生成和重复扣费。
4. 远程结果必须由 Main 下载、验证真实格式并落入受管项目资产后再进入画布。

## 5. 视频接口与 Seedance

官方同时保留两组视频表面：

| 操作 | 通用任务接口 | OpenAI 兼容接口 |
| --- | --- | --- |
| 创建 | `POST /v1/video/generations` | `POST /v1/videos` |
| 查询 | `GET /v1/video/generations/{task_id}` | `GET /v1/videos/{task_id}` |
| 下载 | 返回结构中的 URL | `GET /v1/videos/{task_id}/content` |

官方通用请求 DTO 文档包含：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "商品在真实使用场景中缓慢转动",
  "image": "https://... 或 Base64",
  "duration": 5,
  "width": 1280,
  "height": 720,
  "fps": 30,
  "seed": 1,
  "n": 1,
  "metadata": {}
}
```

但官方当前 Doubao adaptor 实际从通用任务体读取 `seconds`，并从 `metadata` 读取 Seedance 扩展参数。待真实 Token 兼容测试时应验证下面的兼容请求，而不是直接投入批量生成：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "...",
  "image": "...",
  "seconds": "5",
  "duration": 5,
  "metadata": {
    "resolution": "1080p",
    "ratio": "16:9",
    "frames": 121,
    "camera_fixed": false,
    "watermark": false
  }
}
```

这不是正式固定 Schema。SparkAI WorkSpace 已基于该兼容体完成独立任务适配器，但未发起真实请求；必须等用户明确允许测试后，用所选 Token 做一条最小任务，确认站点实际接受的字段，再保存为该 Base URL/Token 的协议画像。

### 返回结构差异

- 创建结果可能使用 `id`、`task_id`，两者都要接受。
- 状态至少要统一 `queued`、`in_progress`/`processing`、`completed`/`succeeded`、`failed`。
- 官方 `/v1/videos/{task_id}` 会返回 OpenAI Video 结构，结果 URL 可能位于 `metadata.url`。
- 当前源码的 `/v1/video/generations/{task_id}` 仍可能返回 `{ "code": "success", "data": TaskDto }`，与 OpenAPI 中顶层 `url` 的描述不完全一致。
- 下载实现应优先使用受鉴权的 `/v1/videos/{task_id}/content`，其次才接受经过公网安全校验的结果 URL。

SparkAI WorkSpace 已实现独立 create/poll/normalize/download 适配器、项目 journal、重启恢复、画布入口和 `canvas.generate-video` CLI，不复用 Chat Completions 解析器。创建 POST 不自动重试：4xx 明确拒绝记为失败，5xx、超时和无任务 ID 响应记为 `create-unknown`；有远端任务 ID 时重启仅恢复 GET 轮询与下载。下载优先使用受鉴权的 `/v1/videos/{task_id}/content`，失败后才尝试经过公网/DNS/socket 校验的结果 URL。

项目只在 `<project>/.naimage/video-task-journal.json` 保存任务、相对输出路径及 Base URL/Token 的单向凭证指纹；不保存 Key、绝对路径、运行时 `naimage-asset:` URL，也不向 Renderer/CLI 公开可能带签名参数的上游结果 URL。结果成功落盘后会从 journal 清除临时结果 URL。生成文件写入 `<project>/output/video/generated`；重启发现 `ready` 记录缺少文件时会恢复为待下载状态，而不会重复创建上游任务。

## 6. 计费、并发与恢复

NewAPI 的任务链路会在提交阶段预扣额度，失败时由服务端尝试退款；上游已经接受的请求仍可能产生费用。SparkAI WorkSpace 只负责展示请求规模并执行用户明确发起的生成，不代替用户与账号站或 Base URL 站结算。

实现要求：

- POST 默认不做网络级自动重试；如站点支持幂等键，再按站点能力开启。
- 高并发先执行 1 个小批量探测，成功后按 wave 渐进放量。
- 429、5xx、网络异常触发全局 ramp hold；连续保护性失败打开 circuit，停止未派发任务。
- 轮询使用指数退避和随机抖动，并尊重 `Retry-After`。
- 视频任务 ID、协议画像、最后状态和结果下载状态写入项目 journal，重启后继续轮询，不能重复创建任务。
- `/api/pricing` 只用于费用提示和能力辅助，实际扣费以 Relay 返回与账户日志为准。

## 7. 推荐开发顺序

### P0：当前模型与图片链路

- 已接入 `/v1/models` 的端点能力字段，并保留错误元数据回退。
- 保持模型目录 60 秒共享缓存，减少设置页、弹窗和 Agent 的重复请求。
- 为每个 Base URL/Token 保存不含凭证的能力画像：版本、可见模型、端点类型、流式支持和最近验证时间。
- 模型列表刷新继续由用户显式触发或缓存过期触发，不在每次打开弹窗时联网。

### P1：真实视频验证

- 已完成独立 video provider adapter，覆盖创建、轮询、状态归一化、下载和失败恢复。
- 先针对一个 Seedance Token 执行 1 条最小兼容测试，确认 `seconds/duration`、结果 URL 和计费日志。
- 画布结果节点、项目落盘与单任务 CLI 已接入；验证成功后固定接入画像，再考虑批量视频的 probe/ramp。

### P2：上游协作

- 向站点维护者反馈 DoubaoVideo 的 `openai-video` 能力分类遗漏。
- 建议上游统一 `/v1/video/generations/{id}` 与 `/v1/videos/{id}` 的状态/结果结构。
- 建议 `/api/pricing` 或 `/v1/models` 增加稳定的参数能力描述，例如时长范围、分辨率、比例、图生视频支持、幂等支持和价格单位。

## 8. 本轮没有执行的动作

- 未读取任何 API Key。
- 未提交任何可能计费的图片或视频任务。
- 未运行测试、类型检查、构建、Bundle、打包或发布。
- 只完成代码与文档开发；Seedance 协议和计费行为仍待用户明确授权的一条最小任务验证。
