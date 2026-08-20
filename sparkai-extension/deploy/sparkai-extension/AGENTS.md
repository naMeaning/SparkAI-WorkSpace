# SparkAI Extension 部署 Agent 约束

## 目标

把当前压缩包中的 SparkAI Extension 作为独立单实例 Docker 服务部署到用户已有的原生 New API 旁边。不得修改、复制、重建或升级 New API 源码、镜像、数据库、渠道、账号、quota、计费和管理后台。

最终流量必须是：

```text
Cloudflare
  /api/naimage/license* -> SparkAI Extension
  /v1/image-tasks*      -> SparkAI Extension
  其他路径               -> 现有原生 New API

SparkAI Extension -> Docker 内网 -> 原生 New API /v1/images/generations
```

## 绝对约束

- `SPARKAI_NEW_API_UPSTREAM` 必须是 Docker 容器 DNS/alias 与内部端口，例如 `http://new-api:3000`；禁止填写公网域名、Cloudflare 域名或公网 IP。
- 只允许修改本扩展的 `.env`、Compose、数据卷和现有反向代理中的两个路径规则。不要修改 New API 容器配置或数据库。
- 不得输出、提交或写入普通日志：管理员 Token、HMAC secret、New API Key、Cookie、兑换码明文或 License token。
- `.env` 权限必须为 `600`，不得进入 Git。`SPARKAI_EXTENSION_HASH_SECRET` 上线后必须稳定保存；更换它会使既有兑换码、License 和任务 owner 全部失效。
- 只运行一个扩展副本。不得使用 Swarm/Kubernetes 多副本，不得自动重放重启前的图片任务。
- 不得执行 `docker compose down -v`、`docker volume rm`、清空 `/data` 或删除旧备份。
- 未获得用户对真实付费请求的明确授权时，只做 health、License 配置和 New API `/api/status` 的无费用检查，不创建真实图片任务。

## 第一步：只读识别现有环境

先执行只读检查，不要完整输出 `docker inspect`，因为其中可能包含环境变量秘密：

```bash
docker version
docker compose version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Networks}}'
docker inspect <NEW_API_CONTAINER> --format '{{json .NetworkSettings.Networks}}'
```

确认并记录：

1. 原生 New API 容器名称。
2. 它所在的 user-defined bridge network 名称，常见形式为 `<compose-project>_default`。
3. 该网络中可解析的 New API DNS/alias 和容器内部监听端口。
4. Caddy/Nginx 是宿主机进程还是 Docker 容器。
5. 公开 API 域名及当前 New API catch-all 配置文件位置。

不要猜测容器名、网络名或端口。如果 New API 只有 Docker 默认 `bridge`，先向用户确认目标容器，再创建专用 user-defined bridge network，并以 `docker network connect --alias new-api <network> <container>` 连接；不要重建 New API 容器。

## 第二步：创建私密配置

```bash
cp .env.example .env
chmod 600 .env
```

在不回显秘密的方式下生成两个相互独立、至少 32 字节的随机值，例如使用 `openssl rand -hex 32`。填写：

```text
SPARKAI_DOCKER_NETWORK=<现有 New API Docker network>
SPARKAI_NEW_API_UPSTREAM=http://<New API DNS或alias>:<内部端口>
SPARKAI_EXTENSION_ADMIN_TOKEN=<独立随机值>
SPARKAI_EXTENSION_HASH_SECRET=<另一个独立随机值>
```

不要把 New API 管理员密码、数据库密码或模型 Key 当成这两个 secret。

## 第三步：静态校验和启动

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env build
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

若 external network 不存在，停止并重新核对 `SPARKAI_DOCKER_NETWORK`；不要偷偷退回 `host.docker.internal` 或公网域名。

检查容器状态和扩展自身健康：

```bash
curl -fsS http://127.0.0.1:17910/healthz
docker compose --env-file .env logs --tail 100 sparkai-extension
```

日志只汇报状态和错误码。发现疑似凭据时不要复制到对话中。

## 第四步：证明 Docker 内网可达 New API

在扩展容器内请求原生 New API 的公开状态端点，不走公开域名：

```bash
docker compose --env-file .env exec -T sparkai-extension \
  node --input-type=module -e "const u=new URL('/api/status',process.env.SPARKAI_NEW_API_UPSTREAM);const r=await fetch(u);console.log('new-api-internal-status='+r.status);if(!r.ok)process.exit(1)"
```

输出 URL 时不得包含凭据。该检查必须成功，且 `SPARKAI_NEW_API_UPSTREAM` 必须仍是容器 DNS地址，才能继续配置反向代理。

## 第五步：合并反向代理规则

不要覆盖整个现有 Caddyfile/Nginx 配置。先备份，再把两个扩展路径放在原生 New API catch-all 前面：

```text
/api/naimage/license
/api/naimage/license/*
/v1/image-tasks
/v1/image-tasks/*
```

- 代理也在同一 Docker network：扩展上游使用 `sparkai-extension:17910`，参考 `Caddyfile.example`。
- 代理运行在宿主机：扩展上游使用 `127.0.0.1:17910`，参考 `Caddyfile.host.example`。
- 代理容器不在 New API network：先只读确认其网络，再将代理容器连接到同一 user-defined network；不要暴露 17910 到公网。

修改后先运行代理自身的配置校验，再 reload。任何校验失败都恢复备份，不要带错误配置重启。

## 第六步：无费用验收

```bash
curl -fsS https://<API_DOMAIN>/api/naimage/license
curl -fsS https://<API_DOMAIN>/api/status
```

验收条件：

- `/api/naimage/license` 返回 Extension 的 License 配置。
- `/api/status` 仍由原生 New API 正常返回，证明 catch-all 没有被扩展抢占。
- `docker compose ps` 显示扩展 healthy。
- 容器内 New API 状态检查成功。
- 宿主机只监听 `127.0.0.1:17910`，公网安全组不新增 17910。

浏览器访问 `https://<API_DOMAIN>/api/naimage/license/admin` 应显示扩展自带的 License 管理登录页。管理员 Token 只能在该页面的密码框中输入，不得拼入 URL、写入浏览器持久存储、截图或日志。页面可设置每码设备次数、授权有效天数、兑换截止时间，并禁用兑换码；禁用会立即撤销该码现有设备 License。新兑换码以服务端密文保存，管理员可在列表中反复查看/复制；启用前创建的 HMAC-only 历史码会显示为不可恢复。

如需嵌入已有 Admin，设置 `SPARKAI_EXTENSION_ADMIN_FRAME_ORIGINS` 为精确的逗号分隔 Origin（例如 `https://admin.example.com`）。留空时 CSP 与 `X-Frame-Options: DENY` 都会拒绝 iframe；配置白名单后由 CSP `frame-ancestors` 控制，扩展不会接受通配符、路径或凭据。嵌入页仍使用管理员 Token 登录，不能把 Token 放入 iframe URL、Cookie、localStorage 或 postMessage。

管理员发码属于生产数据变更，只有用户明确要求时才执行。可在容器内使用：

```bash
docker compose --env-file .env exec -T \
  -e SPARKAI_EXTENSION_URL=http://127.0.0.1:17910 \
  sparkai-extension node src/license-admin.mjs create \
  --name 'SparkAI Pro' --count 1 --valid-days 0 --max-devices 3
```

不要把命令返回的兑换码发到普通聊天或日志；立即交给用户指定的密码库/发码系统。

## 备份、升级和回滚

- 备份对象：Compose 数据卷中的 `/data`、部署 `.env` 的安全副本、当前代理配置备份，以及本部署包和 `SHA256SUMS.txt`。
- 升级前先确认没有 running 图片任务，备份数据卷，再使用新包 `build` 和 `up -d`；不得同时启动两个版本。
- 回滚时恢复上一包和代理备份，保留同一个数据卷及 HMAC secret。仅使用 `stop`、`up -d` 或不带 `-v` 的 `down`。
- 服务重启后 queued/running 任务变为 failed 是既定防重复策略，不要自动重新 POST。

## Codex 最终报告

只汇报：扩展版本、源码 revision、选用的 Docker network、脱敏后的内部上游形态、代理运行位置、Compose/health/internal-status/public-route 的真实结果、备份位置和未执行的真实生图验证。不得汇报任何 secret、完整兑换码、Cookie 或模型 Key。
