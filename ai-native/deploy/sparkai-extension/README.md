# SparkAI Extension 部署包

该 Compose 只部署 SparkAI Extension，不包含、不修改也不升级原生 New API。扩展容器默认加入 New API 已使用的 Docker 内网，并通过容器 DNS 调用同步 `/v1/images/generations`，避免再次经过 Cloudflare。

部署前先让 Codex 完整读取包根目录的 `AGENTS.md`。最小流程：

```bash
cp .env.example .env
chmod 600 .env
# 填写现有 New API 的 Docker network、容器 DNS/内部端口和两个随机 secret。
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
curl -fsS http://127.0.0.1:17910/healthz
```

反向代理也在 Docker 时使用 `Caddyfile.example`；Caddy 安装在宿主机时使用 `Caddyfile.host.example`。只能把 `/api/naimage/license*` 与 `/v1/image-tasks*` 放到扩展服务，其他路径继续交给现有原生 New API。

必须备份 `sparkai-extension-data` 数据卷和稳定的 `SPARKAI_EXTENSION_HASH_SECRET`。只运行一个副本；重启后未完成图片任务按防重复策略失败且不自动重放。回滚不得执行 `docker compose down -v`。
