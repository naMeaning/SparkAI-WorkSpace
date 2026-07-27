# New API 双接入与激活授权部署说明

本文对应 naimage 1.0.6 的两种服务接入方式和设备激活授权。它面向 New API 运维与桌面开发，不包含任何生产密钥。

## 1. 两种接入模式

### 账号模式

用户用 New API 用户名/密码登录。桌面保存服务端 session，读取用户额度、分组和模型，并请求：

```text
/naimage/v1/models
/naimage/v1/chat/completions
/naimage/v1/responses
/naimage/v1/images/generations
/naimage/v1/images/edits
```

这条链路由 New API 选择渠道、扣除额度并记录日志。桌面把 `modelGroup` 放入 JSON 或 multipart 请求；服务端只允许用户实际可用的分组。

### 自定义 API 模式

用户提供 Base URL、API Key、Agent 模型和生图模型。桌面直接请求 OpenAI-compatible 标准端点：

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

API Key 保存在 Electron 的 `app-settings.json`，不会进入项目、模型缓存、Git 或日志。桌面软件无法在服务端强制控制用户自有 Key 的调用，因此自定义模式的激活门禁属于客户端授权边界；账号模式的 Session Relay 同时有服务端强制门禁。

## 2. 激活授权模型

- 客户端首次启动生成随机安装 ID，不读取 CPU、硬盘、MAC 等硬件指纹。
- 两种接入模式共用同一个安装授权，切换模式不重复核销。
- 激活码明文只在管理员创建时返回一次，数据库只存 SHA-256 和短提示。
- 授权令牌也只以 SHA-256 保存；客户端保存授权令牌，不保存兑换码。
- 默认每 24 小时在线校验一次；服务不可用时允许最近一次成功校验后的 72 小时离线宽限。
- 禁用激活码会同时禁用由该码产生的全部授权。
- `valid_days=0` 表示永久授权；`max_activations` 是可激活安装数量。

后端自动迁移以下表：

```text
naimage_activation_codes
naimage_activation_grants
```

正式升级数据库前仍应按现有运维流程备份数据库，并先在测试环境验证迁移。

## 3. 推荐上线顺序

1. 部署包含激活接口的 New API，保持 `NAIMAGE_LICENSE_REQUIRED=false`。
2. 请求 `GET /api/naimage/license`，确认返回 `required: false`。
3. 用管理员会话创建测试激活码，分别验证账号模式和自定义模式。
4. 验证账号模式的分组、额度、Agent 和生图；验证自定义模式的模型与生图端点。
5. 创建正式激活码批次并安全保存本次返回的明文。
6. 设置 `NAIMAGE_LICENSE_REQUIRED=true`，重启/滚动发布 New API。
7. 再请求配置接口确认 `required: true`，并验证未激活账号 Relay 返回 HTTP 402。

不要在尚未发放激活码、客户端尚未部署时直接开启强制门禁，否则现有用户会被阻断。

## 4. 环境变量

```text
NAIMAGE_LICENSE_REQUIRED=false
```

测试完成后改为：

```text
NAIMAGE_LICENSE_REQUIRED=true
```

布尔值由 New API 的环境配置读取。修改后需要让服务进程重新加载环境变量。不要把数据库密码、GitHub Token、更新签名私钥或用户 API Key 写入仓库。

## 5. 接口

公开配置：

```text
GET /api/naimage/license
```

设备模式激活与校验：

```text
POST /api/naimage/license/activate
POST /api/naimage/license/verify
```

账号模式激活与校验，需要 New API 用户 session：

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

创建 10 个单设备、有效 365 天的授权码：

```powershell
$body = @{
  name = "naimage-standard-2026"
  count = 10
  plan = "standard"
  valid_days = 365
  max_activations = 1
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

强制授权开启后，账号 Relay 请求必须携带：

```text
Cookie: session=...
New-Api-User: <user id>
X-Naimage-Device-Id: <random install id>
X-Naimage-License: <license token>
```

常见结果：

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| `GET /api/naimage/license` 为 404 | 后端尚未部署扩展 | 先部署本仓库 New API 版本；客户端会视为未启用门禁 |
| Relay 返回 402 | 缺少、失效或过期授权 | 重新激活，检查设备 ID/令牌是否成对，检查码是否被禁用 |
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
corepack pnpm run test:custom-api-transport
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm run test:bundle
corepack pnpm run aidebug:gui
```

New API 定向验证：

```powershell
& "C:\Program Files\Go\bin\go.exe" test ./model ./controller ./middleware
```

日常开发不需要运行完整 AIDebug surface/performance 套件；只有跨页面 UI 或正式发布前按对应发布流程补充。
