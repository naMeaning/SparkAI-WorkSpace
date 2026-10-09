# 上游图片与账户接口核对（2026-10-07）

当前 Goal 的本地交付已完成；用户暂缓重新登录后的真实账户复验。本文件记录实际源码与测试，静态按钮审计与 Mock 不代表全部按钮或真实账户逐项实测。

## 只读源码快照

通过本机 `http://127.0.0.1:7897` Git 代理进行 depth=1 clone。快照放在 `.diagnostics/upstream-research/2026-10-07/`，不打入客户端、不安装上游依赖、不修改服务端。

| 项目 | commit | 主要证据 |
| --- | --- | --- |
| [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground/tree/cdc171df465b414cba616f7c1d2fd482e11239bf) | `cdc171df465b414cba616f7c1d2fd482e11239bf` | `src/lib/apiProfiles.ts` 的 OpenAI / Sub2API submit、editSubmit、poll 和 multipart files 定义 |
| [New API](https://github.com/QuantumNous/new-api/tree/973cf8ef4600947a4270e95ada7916740fa8264c) | `973cf8ef4600947a4270e95ada7916740fa8264c` | `router/api-router.go`、`router/relay-router.go`、`controller/log.go`、`controller/misc.go`、`common/page_info.go`、`setting/operation_setting/general_setting.go` |
| [Sub2API](https://github.com/Wei-Shaw/sub2api/tree/b8dece9000c68815a5b867ca5a1e6f236e173905) | `b8dece9000c68815a5b867ca5a1e6f236e173905` | `backend/internal/server/routes/gateway.go` 的同步与异步 Images 路由 |

## 图片合同

| 动作 | 上游合同 | 桌面 owner / 当前证据 |
| --- | --- | --- |
| 生成 | `POST /v1/images/generations`，JSON，model / prompt / n / size / quality 等 | `runtime/image-generation/adapters.cjs`、`desktop/image-generation-service.cjs` |
| 编辑 / 多参考 | `POST /v1/images/edits`，multipart，`image[]`，prompt 和相同输出参数 | 同一 adapter 的 edit 分支，来源图由 Main 本地读取 |
| 遮罩 | multipart `mask` 为 <4MB PNG，透明区域代表编辑区，尺寸匹配第一张输入 | `desktop/image-mask-compat.cjs` 校验来源与 alpha；网关明确 400/422 拒绝 mask 时仅一次无 mask 编辑，然后在 Main 合成并保留遮罩外原像素。超时、未知结果、task id 或 unsafeToRetry 都禁止该补试；未来同一能力指纹跳过拒绝字段 |
| Sub2API 异步生成 / 编辑 | `/v1/images/generations/async`、`/v1/images/edits/async`；返回 `task_id`，GET `/v1/images/tasks/:task_id` | `desktop/new-api-client.cjs` 既有 create/poll 合同；图片 adapter 自动识别 Sub2API host。任意域名是否确实有该能力仍需真实验证 |

官方 [编辑参考](https://developers.openai.com/api/reference/resources/images/methods/edit) 与 [GPT Image 2 模型](https://developers.openai.com/api/docs/models/gpt-image-2) 已打开核对；继续显式使用 `gpt-image-2`。该模型编辑时省略 `input_fidelity`。较新 Playground 的默认模型不能作为迁移桌面默认值的授权。

## 原生用户账户合同

| 数据 / 动作 | New API 接口 | 桌面实现 |
| --- | --- | --- |
| 用户额度、累计使用、请求次数、分组 | `GET /api/user/self` 的 quota / used_quota / request_count / group | `desktop/new-api-account.cjs` 的 summary / wallet DTO；不编造固定图片价格或免费张数 |
| 展示单位 | `GET /api/status` 的 quota_per_unit / quota_display_type / usd_exchange_rate / custom_currency_* | USD / CNY / TOKENS / CUSTOM；缺失单位或汇率只展示原始 quota；共享 15 分钟 Main 缓存；登录首响应只读缓存，不阻塞登录 |
| 密钥 CRUD / 选择 | `/api/token/`、`/api/token/:id/` 与 Main-only key 获取 | 复用 `desktop/account-token-service.cjs` 和现有设置接入页；账户页“管理密钥”进入同一界面 |
| 用户日志 | `GET /api/log/self`，`p` / `page_size` / `type` / `model_name` / `token_name` / `group` / `request_id` / `start_timestamp` / `end_timestamp` | Main 白名单 DTO、服务端 total / page / hasMore、账户切换丢弃旧响应；AccountDrawer 拥有查询与错误状态 |

日志 `other` 不向 Renderer 展开；白名单保留额度、模型、密钥名称、分组、输入/输出 tokens、耗时和安全消息。不使用已废弃的 `/api/log/self/search`。余额允许原生负值；服务端未给展示单位时不能凭 quota_per_unit 猜 USD。

设置页展开全部密钥（包括停用/过期项），同一编辑器维护状态、永久/到期时间、额度、IP 白名单、模型限制、跨分组重试；不会在 UI 展示完整 Key。额度输入遵循 New API `web/src/lib/format.ts` 的展示单位逆换算：USD/CNY/CUSTOM 使用已知单位/汇率，TOKENS 或单位未知输入 raw quota。Main 派生 inputUnit/remainAmount 并在 create/update 将 remainAmount+quotaInput 核对、转换为 remain_quota；单位变化或非法金额在任何 PUT 前拒绝。只修改名称/限制而未改额度时使用最新服务端额度。缓存不存 IP/模型限制，因此从缓存打开编辑器必须先刷新完整元数据。原生新建请求始终启用，停用创建须随后调用 `PUT /api/token/?status_only=true`，并保留原选用 key。

## 本轮实际证据与剩余项

- `test:new-api-account`：最新 38 cases、0 网络请求；验证多种单位、缺失单位/汇率、负余额、敏感字段过滤、分页参数、账户切换和 IPC 转发。
- `typecheck`、`test:ipc-registration`、`test:account-token`、`test:account-token-quota` 已通过。
- `test:new-api-login` 复测：70 ms、只发一次 login、后续请求仍延后，凭据加密和 DTO 脱敏通过。首次与构建/GUI 并行运行时计时断言失败（4155 ms），保留该失败而不放宽 1000 ms 门槛。
- `aidebug:account`：6 checks / 7 screenshots / 0 模型请求，报告 `.diagnostics/electron/glass-workspace-2026-10-06T19-29-37-236Z/report.json`。实测 884×640 布局、失败类型筛选、详情展开、25 条服务端夹具的第二页 5 条、刷新、无匹配结果、进入密钥管理及扩展字段；已人工查看日志详情和编辑器截图。最后秒级期限/CSS owner 归位会由生产程序 smoke 再验证。
- `test:image-mask-compat`：66 pixel assertions、5 类不允许重建错误、私有结果 URL 拒绝与取消检查通过，0 网络；`test:remote-asset-security` 逐跳/DNS/socket/准入/字节上限通过。Production build 已通过（1676 modules），最终代码仍需重新构建和打包，当前 EXE 尚属旧主题轮次。
- 已安装配置的真实只读账户探针：profile / status / token list / logs / key resolution 均 HTTP 200；4 枚密钥、3 枚启用，日志 total=1852、读取 5 条。报告 `.diagnostics/upstream-probe-2026-10-06T18-04-51.558Z/report.json`。探针使用原 userData 才能解密，未输出凭据、未修改密钥、未支付。
- 真实图片共 3 张，均使用已配置的独立模型 key，无视频：生成 `.diagnostics/upstream-probe-2026-10-06T18-08-03.540Z/report.json`；普通编辑 `upstream-probe-2026-10-06T18-10-42.060Z/report.json`；遮罩兼容 `upstream-probe-2026-10-06T19-16-52.145Z/report.json`（后两项同在 `.diagnostics/`）。第一次遮罩请求被网关 400 明确拒绝，普通编辑使用原生成图，未再创建来源图。兼容修复后一次明确拒绝加一次成功编辑，输出 `mask-edited.png` 的 SHA-256 为 `eacad3bcd8c7f265c4556080b993edbc1db652c8321d22b84e7b13726c57e9de`。
- 像素报告 `.diagnostics/upstream-probe-2026-10-06T19-16-52.145Z/mask-pixel-validation.json`：1254×1254；遮罩外 965,601 像素差异 0，遮罩内 606,915 像素中 606,333 变化。该证据只支持当前网关同步路径，不宣称所有 Sub2API 域名异步或所有上游都已实测。
- 按钮静态审计最新 441 项（430 React、10 独立窗固定按钮、1 动态复制按钮），未绑定 0，5 个转发组件已检查 owner；清单 `.diagnostics/ui-action-audit.json`。已移除不提供实际充值结果的入口，受影响界面有专项；完整 surface smoke `.diagnostics/electron/aidebug-2026-10-07T00-45-42-192Z/report.json` 为 15 场景、0 failures，涵盖手动生图菜单、双击一次派发/两图结果/timeline、画布与素材同源、参考图、Prompt/FastMemory 编辑和导出表面。此证据仍不等于所有 441 按钮都逐个鼠标执行。
- 探针错误与待补项：首次账户检查触发 refresh cookie 轮换，但原脚本只更新内存，令保存的旧凭据失效。已向用户说明并修正加密持久化认证字段/账户 CAS；现在探针直接拒绝 auth/refresh，轮换由已安装软件唯一拥有，避免并行诊断影响登录。新凭据加入错误脱敏列表；待用户重新登录后只读复验。未调用真实密钥新增/停用/删除、支付或管理后台写入，CRUD 由接口对照与 loopback/Mock 专项验证。
- 最新两种开发 EXE、生产程序 smoke、安装器 UI 与哈希统一见 `PROGRESS.md` 首节和 `.diagnostics/release/local-delivery-01a11418-2026-10-07.json`；本地交付完成，重新登录后的真实账户复验由用户选择 deferred。未新增模型用量。
