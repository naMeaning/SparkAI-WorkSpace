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

部署和反向代理验证完成后，打开：

```text
https://<你的 API 域名>/api/naimage/license/admin
```

输入 `.env` 中的 `SPARKAI_EXTENSION_ADMIN_TOKEN` 即可创建和管理兑换码。可设置每个兑换码的设备使用次数、激活后的授权天数、兑换截止时间；列表会显示已用次数，并可禁用兑换码。禁用会同时撤销该码已经发出的设备 License。新建兑换码会加密保存，管理员可以从列表反复查看和复制；旧数据库中没有密文的历史码会标记为不可恢复。管理员 Token 不要放进 URL、截图或普通聊天；刷新或退出页面后需要重新输入。

若要把管理页嵌入已有 Admin，先在 `.env` 配置 `SPARKAI_EXTENSION_ADMIN_FRAME_ORIGINS=https://你的-admin-域名`，然后把 `/api/naimage/license/admin` 作为 iframe 地址。只填写精确 Origin（不带路径、查询参数或通配符）；留空则默认拒绝 iframe。

必须备份 `sparkai-extension-data` 数据卷和稳定的 `SPARKAI_EXTENSION_HASH_SECRET`。只运行一个副本；重启后未完成图片任务按防重复策略失败且不自动重放。回滚不得执行 `docker compose down -v`。
