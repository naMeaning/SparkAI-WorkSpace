# 画布图片加入本轮素材

- Mode: implement / Goal
- Outcome: “添加原图 / 添加参考图”可从画布图库选取；图片/容器/成员/多选右键可加入本轮素材，画布取消选择后保持。
- Scope: ReferencePickerDialog、selection-reference-images、main Composer/菜单/TaskScope、agent.add-canvas-materials 共享命令。
- Non-goals: 新素材存储、画布角色或图片文件修改、远端服务实现、真实模型验证、正式发布。
- Acceptance: 真实 Electron 操作与可见状态/截图；单成员来源不扩展为整容器；去重/角色/容量/取消与发送附件；专项契约、quick GUI、生产构建。
- Authorization: 用户授权本地实现和验证；不因添加素材而调用 Agent/模型。
- State: verified（本地源码交付），2026-10-07。

用户追加：在既有图片服务与 `runtime/image-generation` 上适配 Grok/Gemini。最新要求以显式渠道配置决定 Adapter，模型名称只提供未配置/auto 的默认；沿用逐模型连接与凭据边界，保留前端、上传、成果和 OpenAI Compatible。详细调用链、耦合及修改文件见 `IMAGE_PROVIDER_ADAPTATION_2026-10-07.md`。Mock 证明 endpoint、认证、素材和响应，真实模型调用未授权。

现有本轮原图/参考图列表为唯一素材存储。画布显式素材保存节点及成员身份，绑定优先于自动选择；新文件沿用项目库导入。发送使用原画布来源，不重复创建附件容器。命令仅接收项目/画布 guard、role 和 nodeId/可选 assetIndex，不接受文件路径。

2026-10-07 实测补项：右键具体成员通过既有 assetSourcesByHost 从 canonical owner 映射画布槽位；ReferenceImage 保留 bindingId/ownerNodeId/ownerAssetIndex/containerId，TaskScope 中 source/reference 均保留成员身份。Agent 原图 200/参考图 40；普通参考弹窗仍为 9。设置 MenuSurface portal 点击不得被旧外部点击监听误关。专项入口 `aidebug:canvas-materials`；最终报告与 build 状态以 PROGRESS 最新记录为准。

最终证据：`aidebug:canvas-materials` 报告 `.diagnostics/electron/canvas-materials-2026-10-07T04-41-50-994Z/report.json` 为 12 checks/9 screenshots/0 真实模型请求；精确成员两次发送到达 Main/runtime，接口配置在 Main 保存并 reload 恢复。小窗口图库、容量和配置截图已查看。`aidebug:gui` 报告 `.diagnostics/electron/aidebug-2026-10-07T04-43-35-350Z/report.json` 通过；`corepack pnpm run build` 退出 0（1676 modules、22.07s）。相关素材/容器 17、配置 127、transport 40 cases 与 Adapter/service、automation、typecheck 通过。

未验证：真实 provider/各中转站联调、Google Interactions API、完整实际安装/卸载、签名或正式发布。本轮没有新模型用量；旧账户复验继续 deferred。

用户在源码交付后明确要求打包 EXE：Unrestricted/SparkAPI 两种 1.0.9 x64 本地开发安装包的构建、实际程序与安装器 UI 验收已完成，各程序 18 截图、各安装器 19 截图；两 EXE 的 MZ/大小/SHA-256/NotSigned 和各 ASAR 的 12 文件匹配均已复核。打包结果汇总 `.diagnostics/release/image-adaptation-delivery-2026-10-07.json`，详细过程见 GOAL/PROGRESS。真实模型/账户、日常安装、签名和正式发布仍不在本轮范围。
