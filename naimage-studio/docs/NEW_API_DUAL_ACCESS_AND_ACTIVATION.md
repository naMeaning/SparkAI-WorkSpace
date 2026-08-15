# New API 双接入与激活授权部署说明

本文对应 SparkAI WorkSpace 的两种服务接入方式、双发行策略和设备激活授权。它面向 New API 运维与桌面开发，不包含任何生产密钥。

构建期提供两个发行版：`dual-access` 保留下文两种接入方式；`sparkapi-account` 只允许 `https://sparkapi.org` 账号登录，并在 Electron Main 拒绝自定义 Base URL/API Key。生产门禁来自随构建写入的 `sparkai-access-policy.json`，运行 EXE 时设置环境变量不能解锁。构建入口为 `build:unrestricted`、`build:sparkapi`，需要同时生成两种安装包时使用 `package:win:variants`。

## 1. 两种接入模式

### 账号模式

用户用 New API 用户名/密码登录。登录成功本身就是进入软件的授权，不需要兑换码或设备 License。桌面保存服务端 session，用它读取用户、额度和密钥元数据，再以所选账户 Key 请求标准模型端点：

```text
/v1/models
/v1/chat/completions
/v1/responses
/v1/image-tasks
/v1/images/generations
/v1/images/edits
```

每个对话或图片模型都可以另填自定义 API Key。请求凭据优先级为“模型自定义 Key → 模型绑定账户 Token → 全局账户 Token”；模型自定义 Key 仍请求账号/Relay 地址，账号模式不使用模型绑定中的自定义 Base URL。完整 Key 只在 Electron Main 内存或 Windows `safeStorage` sidecar 中存在，不进入 Renderer。账号 token 自身决定分组，模型请求不额外发送客户端 `group`。

### 自定义 API 模式

当前设备必须先用 Pro 兑换码完成授权，之后用户才能提供 Base URL、API Key、Agent 模型和生图模型。已经授权的设备以后只按缓存周期校验，不重复输入兑换码。桌面直接请求 OpenAI-compatible 标准端点：

```text
/v1/models
/v1/chat/completions
/v1/responses
/v1/images/generations
/v1/images/edits
```

Base URL 可以写成 `https://example.com` 或 `https://example.com/v1`，客户端会避免重复追加 `/v1`。自定义请求不携带 SparkAPI 的用户 session 或 `group`。若 `/v1/models` 不可用，只要用户手工填写了模型名，仍可保存配置。

自定义模式的纯文生图优先采用 Responses Image Generation：`POST /v1/responses`，Base URL 与 API Key 取图片渠道配置，顶层 `model` 取 Agent 模型；完整提示词放在 `input`，工具为 `image_generation`，并请求 `partial_images=3`。客户端依次展示三张中间预览，最终图片从 `response.output_item.done` 或 `response.completed` 的 `image_generation_call.result` 提取。`partial_images` 是预览阶段数量，最终成品数量仍为 1；上游可能额外发送索引 3 的最终态 partial，客户端不会把它显示成 `4/3`。

只有上游以 400/404/422 明确表示 Responses 端点、所选 Agent 模型或 `image_generation` 工具不受支持时，客户端才安全回退 `POST /v1/images/generations` 的非流式 `{ model, prompt, size, quality, n }` JSON。HTTP 200 空 SSE、已收到 partial 后断流、`response.failed` 或 `response.incomplete` 都不会触发第二次生图，避免重复扣费。带参考图、蒙版或编辑语义的自定义请求仍使用 `/v1/images/edits` multipart 非流式协议。

自定义 API Key 由 Electron Main 通过 Windows `safeStorage` 加密保存在独立 sidecar；普通 `app-settings.json` 只含占位符，Key 不进入 Renderer、项目、模型缓存、Git 或日志。License 激活/校验固定请求构建策略中的官方账号域名，正文只包含兑换码或 License token 与随机设备 ID，不上传用户 Base URL、API Key 或账号 Cookie。桌面软件无法在服务端强制控制用户自有 Key 的调用，因此自定义模式的门禁由未授权时不可进入工作区、配置 IPC 复核和执行前复核共同保护。

## 2. 激活授权模型

- 客户端首次启动生成随机安装 ID，不读取 CPU、硬盘、MAC 等硬件指纹。
- 设备 License 只解锁自定义 Base URL 模式；账号登录模式不请求、不消费也不依赖 License。
- 自定义模式只接受 `pro` 计划，管理员接口省略 `plan` 时默认创建 `pro`。
- 激活码明文只在管理员创建时返回一次，数据库只存 SHA-256 和短提示。
- 授权令牌也只以 SHA-256 保存；客户端保存授权令牌，不保存兑换码。
- 默认每 24 小时在线校验一次；服务不可用时允许最近一次成功校验后的 72 小时离线宽限。
- 禁用激活码会同时禁用由该码产生的全部授权。
- `valid_days=0` 表示永久授权；正数表示从每台设备激活时开始计算的限时授权。
- `max_activations` 是可激活安装数量；管理员接口省略时默认 3 台。

后端自动迁移以下表：

```text
naimage_activation_codes
naimage_activation_grants
```

正式升级数据库前仍应按现有运维流程备份数据库，并先在测试环境验证迁移。

## 3. 推荐上线顺序

1. 部署包含当前激活接口的 New API。
2. 请求 `GET /api/naimage/license`，确认 `account_license_required=false`、`custom_api_license_required=true`、`custom_api_required_plan=pro`、`default_max_activations=3`。
3. 用管理员会话创建 Pro 测试兑换码，验证永久/限时、同设备重试、3 台上限和禁用撤销。
4. 验证账号登录无需 License 即可进入，并验证逐模型自定义 Key、模型 Token 和全局 Token 的回退顺序。
5. 验证未授权设备不能保存并进入自定义模式；激活后可以配置本地 Base URL/API Key，重启后无需重复输入兑换码。
6. 创建正式兑换码批次并安全保存本次返回的明文，再部署当前桌面客户端。

## 4. 环境变量

当前桌面合同不依赖环境变量：账号登录始终不要求设备 License，自定义 Base URL 始终要求 Pro。旧 `NAIMAGE_LICENSE_REQUIRED` 只保留为历史配置兼容信息，不再控制 Managed Relay 或当前桌面的两种通行条件。不要把数据库密码、GitHub Token、更新签名私钥或用户 API Key 写入仓库。

## 5. 接口

公开配置：

```text
GET /api/naimage/license
```

自定义 Base URL 的 Pro 设备激活与校验：

```text
POST /api/naimage/license/activate
POST /api/naimage/license/verify
```

历史账号激活与校验端点仍保留兼容，但当前桌面账号登录不会调用：

```text
POST /api/naimage/license/account/activate
POST /api/naimage/license/account/verify
```

管理员接口，需要 New API 管理员 session：

```text
GET  /api/naimage/license/admin/codes?page=1&size=20
POST /api/naimage/license/admin/codes
POST /api/naimage/license/admin/codes/:id/disable
```

当前没有配套管理后台页面，先通过管理员 API 管理。

## 6. 创建和管理激活码

在 PowerShell 中先把测试环境地址和管理员会话放入当前进程变量。下面都是占位值，不要原样使用：

```powershell
$naimageApiBase = "https://your-new-api.example"
$naimageAdminCookie = "session=replace-with-admin-session"
$naimageAdminUserId = "1"
```

创建 10 个最多 3 台设备、有效 365 天的 Pro 兑换码：

```powershell
$body = @{
  name = "sparkai-pro-2026"
  count = 10
  plan = "pro"
  valid_days = 365
  max_activations = 3
  expired_time = 0
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "$naimageApiBase/api/naimage/license/admin/codes" `
  -Headers @{ "New-Api-User" = $naimageAdminUserId; Cookie = $naimageAdminCookie } `
  -ContentType "application/json" `
  -Body $body
```

响应中的 `data.codes` 只返回这一次。应立即保存到受控的密码库或业务发码系统，不要写入 Git、聊天记录或普通日志。

列出批次记录：

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "$naimageApiBase/api/naimage/license/admin/codes?page=1&size=20" `
  -Headers @{ "New-Api-User" = $naimageAdminUserId; Cookie = $naimageAdminCookie }
```

禁用 ID 为 12 的激活码及其全部授权：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "$naimageApiBase/api/naimage/license/admin/codes/12/disable" `
  -Headers @{ "New-Api-User" = $naimageAdminUserId; Cookie = $naimageAdminCookie }
```

## 7. 请求与排错

License 激活请求只发送：

```text
POST /api/naimage/license/activate
{ "code": "<pro redemption code>", "device_id": "<random install id>" }
```

后续校验只发送：

```text
POST /api/naimage/license/verify
{ "token": "<license token>", "device_id": "<same install id>" }
```

常见结果：

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| `GET /api/naimage/license` 为 404 | 后端尚未部署当前扩展 | 先部署本仓库 New API 版本；自定义模式保持锁定，账号登录不受影响 |
| 自定义模式提示需要 Pro | 缺少、失效、过期或被撤销的授权 | 重新激活，检查设备 ID/令牌是否成对、计划是否为 `pro`、兑换码是否被禁用 |
| 账号登录成功但无渠道 | 用户分组或渠道模型映射不可用 | 检查 `/api/user/self/groups`、模型权限和渠道分组 |
| 自定义模型列表失败 | 上游没有 `/v1/models` 或 Key 权限不足 | 手工填写模型名，再单独验证 Chat/Responses 和 Images 接口 |
| Responses HTTP 200 但 Agent 无文本 | 上游返回非标准结构或空流 | 客户端已兼容 JSON 和标准 SSE；保留原始响应，在 New API 转换器补对应上游适配 |
| 自定义生图只有空 SSE | 上游 `/v1/images/generations` 声称流式但不产出事件 | 使用当前客户端的 `/v1/responses` + `image_generation` 路径；确认 Agent 模型支持该工具 |
| 有 1/3–3/3 预览但没有成品 | 上游缺少 `output_item.done`/`response.completed` 最终 result | 保留 request id 与原始 SSE 排查上游；客户端不会自动补发，避免重复计费 |
| 授权服务短时故障 | 客户端显示离线宽限 | 72 小时内恢复服务；超过宽限后必须在线校验 |

## 8. 本地验证

Studio 快速验证：

```powershell
corepack pnpm run test:license
corepack pnpm run test:access-variant
corepack pnpm run test:custom-api-transport
corepack pnpm run test:agent-model-binding
corepack pnpm run test:settings-secret-store
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm run test:bundle
corepack pnpm run aidebug:gui
```

New API 定向验证：

```powershell
go test ./model ./controller ./router -count=1
```

日常开发不需要运行完整 AIDebug surface/performance 套件；只有跨页面 UI 或正式发布前按对应发布流程补充。
