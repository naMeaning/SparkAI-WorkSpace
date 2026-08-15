# 原生 New API 双接入与 SparkAI Extension 部署说明

SparkAI WorkSpace 不要求二次开发 New API。用户现有的原生 New API 继续独立升级并负责账号、Token、模型、渠道、quota、计费和用量；`ai-native/services/sparkai-extension` 是单独部署的小型扩展服务，只负责 Pro License 与图片长任务包装。

构建期提供两个桌面发行版：`dual-access` 支持账号登录和 Pro 自定义 Base URL；`sparkapi-account` 只允许 `https://sparkapi.org` 账号登录。生产门禁写入 `sparkai-access-policy.json`，运行 EXE 时不能通过环境变量解锁。

## 1. 两种接入模式

### 账号模式

New API 用户名/密码登录成功就是软件使用授权，不需要兑换码。桌面使用原生接口管理账户与 Token，并用所选 Token 请求标准 `/v1/*`。每个对话/图片模型仍可单独填写自定义 API Key，优先级为“模型自定义 Key → 模型绑定账户 Token → 全局账户 Token”；账号模式忽略逐模型自定义 Base URL，防止把模型 Key 变成未授权的 Base URL 入口。

账号模式纯文生图请求同域 `/v1/image-tasks`。反向代理把这个路径交给 SparkAI Extension，扩展服务在后台通过私网调用原生 New API `/v1/images/generations`。原生 New API 继续完成 Token 鉴权、渠道选择和计费。

### 自定义 Base URL 模式

当前设备必须先通过官方 `/api/naimage/license/activate` 获得 Pro License，之后才能在本地配置 Base URL/API Key。License 请求只含兑换码或 License token 与随机安装 ID，不上传用户 Base URL、API Key 或账号 Cookie。

自定义请求仍直连用户提供的 OpenAI-compatible 地址。若该地址没有 `/v1/image-tasks`，桌面按现有规则回退 Responses/Images 同步接口；SparkAI Extension 不代理、不保存用户的自定义 Base URL 或 Key。

## 2. 扩展服务边界

```text
Cloudflare / sparkapi.org
  ├─ /api/naimage/license/* → SparkAI Extension :17910
  ├─ /v1/image-tasks/*      → SparkAI Extension :17910
  └─ 其他所有路径            → 现有原生 New API

SparkAI Extension
  └─ 私网 SPARKAI_NEW_API_UPSTREAM/v1/images/generations
     → 现有原生 New API
```

`SPARKAI_NEW_API_UPSTREAM` 必须使用回环、Docker service name 或私网地址，不能再次指向 Cloudflare 橙云域名，否则后台长请求仍可能超时。

扩展服务不读取 New API 数据库、不共享 New API session、不复制管理后台。图片 Bearer Key 只存在于处理该任务的进程内存，SQLite 仅保存 HMAC owner；结果文件按保留期清理。服务重启会把 queued/running 标记失败且不重放，避免上游已受理时重复扣费。

## 3. License 模型

- 客户端首次启动生成随机安装 ID，不读取 CPU、硬盘或 MAC 指纹。
- License 只解锁自定义 Base URL；账号模式不请求、不消费 License。
- 只接受 `pro` 计划，默认每码最多 3 台设备。
- `valid_days=0` 是永久授权；正数从每台设备首次激活时计时。
- `expired_time=0` 表示兑换码没有兑换截止时间；正数为 Unix 秒。
- 明文兑换码只在管理员创建时返回一次。
- SQLite 仅保存兑换码、设备 ID、License token 和任务 owner 的带服务端 secret HMAC。
- 禁用兑换码会撤销该码的全部设备 License。
- 客户端 24 小时在线校验缓存和 72 小时离线宽限保持不变。

稳定备份扩展服务数据卷与 `SPARKAI_EXTENSION_HASH_SECRET`。更换 HMAC secret 会使已有兑换码、License 和任务 owner hash 全部失效。

## 4. 部署

扩展服务仓库配置：

```text
ai-native/services/sparkai-extension/.env.example
ai-native/deploy/sparkai-extension/compose.yaml
ai-native/deploy/sparkai-extension/Caddyfile.example
```

部署顺序：

1. 为 `SPARKAI_EXTENSION_ADMIN_TOKEN` 与 `SPARKAI_EXTENSION_HASH_SECRET` 分别生成至少 32 字符的随机值。
2. 设置 `SPARKAI_NEW_API_UPSTREAM` 为现有原生 New API 的私网地址。
3. 启动单实例扩展服务并持久化 `/data`。
4. 把 Caddy 两个扩展路径放在原生 New API catch-all 之前。
5. 验证 `GET /api/naimage/license`，再用管理员 CLI创建测试码。
6. 验证账号登录、Pro 激活、3 台上限、禁用撤销和同一 `task_id` 轮询。

详细 Docker 命令见 `ai-native/deploy/sparkai-extension/README.md`。

## 5. 接口

公开 License：

```text
GET  /api/naimage/license
POST /api/naimage/license/activate
POST /api/naimage/license/verify
```

管理员 License API 使用扩展服务自己的 `SPARKAI_EXTENSION_ADMIN_TOKEN`，不使用 New API 管理员 session：

```text
GET  /api/naimage/license/admin/codes?page=1&size=20
POST /api/naimage/license/admin/codes
POST /api/naimage/license/admin/codes/:id/disable
```

图片任务使用调用者的原生 New API Bearer Key：

```text
POST /v1/image-tasks
GET  /v1/image-tasks/:id
```

POST 立即返回 `task_id`；GET 返回 `queued / running / succeeded / failed`，成功时 `result` 是原生 New API Images JSON。

## 6. 创建兑换码

在 `ai-native` 根目录设置管理员变量：

```powershell
$env:SPARKAI_EXTENSION_URL = "https://sparkapi.org"
$env:SPARKAI_EXTENSION_ADMIN_TOKEN = "部署时配置的管理员 Token"
```

创建 10 个永久 Pro 码，每码最多 3 台：

```powershell
corepack pnpm run license:create -- --name "Pro permanent" --count 10 --valid-days 0 --max-devices 3
```

创建激活后有效 365 天的 Pro 码：

```powershell
corepack pnpm run license:create -- --name "Pro 365 days" --count 10 --valid-days 365 --max-devices 3
```

查看和禁用：

```powershell
corepack pnpm run license:list -- --page 1 --size 20
corepack pnpm run license:disable -- --id 12
```

创建命令输出的 `codes` 只出现一次，应立即进入密码库或发码系统，不得写入 Git、聊天记录或普通日志。

## 7. 排错

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| `/api/naimage/license` 404 | Caddy 未分流或扩展服务未启动 | 检查路由顺序和 17910 健康状态 |
| Pro 激活失败 | 兑换码失效、过期、设备满额或 HMAC secret 不一致 | 用管理员 list/disable 和扩展日志核对，不查看明文 token |
| `/v1/image-tasks` 404 | 请求仍落到原生 New API | 将 image-task 路径放在 New API catch-all 前 |
| task 很快 failed 且 401 | Bearer Key 被原生 New API 拒绝 | 检查桌面所选账户 Token |
| 后台约 2 分钟超时 | Worker 仍经 Cloudflare 请求 New API | 把 `SPARKAI_NEW_API_UPSTREAM` 改为内网地址 |
| 服务重启后任务 failed | 按防重复策略不重放 | 用户明确重新生成；不得自动重建 |
| 自定义 Base URL 生图仍同步 | 用户上游没有 image-task API | 这是兼容行为；扩展服务不会接收用户自定义 Key |

## 8. 验证

扩展服务：

```powershell
cd E:\019创业项目\nimage\ai-native
corepack pnpm run verify:workspace
corepack pnpm run build
corepack pnpm run test
corepack pnpm run check
```

桌面合同：

```powershell
cd E:\019创业项目\nimage\naimage-studio
corepack pnpm run test:license
corepack pnpm run test:custom-api-transport
corepack pnpm run typecheck
corepack pnpm run build
```

所有自动化验证只使用 loopback fixture，不调用真实图片模型。真实 Cloudflare/Caddy/New API 联调必须在部署后单独授权执行。
