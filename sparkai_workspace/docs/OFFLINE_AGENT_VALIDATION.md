# 离线 Agent Phase 4 验证

日期：2026-10-23。状态：实现、专项、production EXE 和原位安装已验证；Git同步收尾中。

## 范围与合同

仍只有一个 Agent Runtime、Prompt、FastMemory、project context、TaskScope 和 image_gen。Main 保存 cloud/local-openai-compatible/managed-local 选择、loopback 地址、受保护凭据和每 run binding；Renderer、CLI/MCP 只见 ID 和脱敏能力，不按模型名称猜测 Responses、工具、视觉或上下文，不静默云端回退。

无工具或视觉声明时同时禁 schema 和实际派发。strict offline 禁云模型/图片/视频/更新、web_search、可启动网络程序的 shell、LAN/remote ComfyUI 及远程 artifact/图片下载。统一下载入口在排队、各跳 DNS 前后重新校验；开启严格离线前拒绝未完成任务与下载。外部本地服务自身是否代理联网不在应用可保证范围。

Main 在网络前 fsync 原任务的脱敏 provider/model/capability/托管 revision/hash，回答续接重启后仍校验原身份；漂移拒绝。公开 task DTO 不暴露该私有 receipt。live binding、地址和凭据不入项目。旧 cloud 设置、Comfy v1 manifest/hash 与 image journal 保持可读，未知图片提交不自动重发。

托管模型复用 artifact store；typed v2 manifest 明确 GGUF LLM、可选 projector 与固定 Windows x64 CPU llama.cpp portable adapter。安装前使用原生计划及授权；未审核 catalog 为空。测试使用假 GGUF、stub 进程，不证明真实 llama.cpp/GPU/模型语义兼容。

## 已采集专项

- `test:agent-provider`：52 组，65 loopback HTTP；`.diagnostics/agent-provider-2026-10-23T04-18-59-329Z/report.json`。SSE UTF8/分段 tool arguments、无工具/视觉、上下文、auth/TLS/redirect/断线、DNS 取消/超时、close 后租约释放、重启与身份漂移；同步严格离线选择从占用检查到保存不让出执行。
- `test:managed-local-llm`：34 项；`.diagnostics/managed-local-llm-1792728049709/report.json`。25 loopback artifact GET、8 health GET、18 stub starts；typed v2/v1 hash兼容、GGUF/projector、安装回滚与版本/任务引用保护。
- `test:agent-offline`：7 组、5 loopback POST；`.diagnostics/agent-offline-1792729384403/report.json`。真实同一 Runtime 的SSE文本/tool第二回合、选择变化仍原binding、无能力拒绝、固定图片配置与原FastMemory重启。
- `test:agent-task`：旧任务契约与新增Main provider receipt持久化、重启续接、托管版本漂移/旧run拒绝及公开投影脱敏通过。
- `test:remote-asset-security`：公共IP、DNS rebinding/socket、redirect、物化/并发去重及新增离线排队/DNS后门禁通过。旧静态断言仍引用拆分前的writeServerImageOutputs，已同步为实际delivery owner；行为覆盖保留。
- artifact store39、Comfy runtime39回归通过；具体报告沿Phase3记录保留。
- `test:agent-offline-main`：22组；`.diagnostics/electron/agent-offline-main-1792729579803/report.json`。真实Main、普通transport、7 loopback Chat POST、3 fake Comfy POST/3 view/2 upload，外部DNS/HTTP与strict后cloud请求均0，不使用aidebugBackend。实际Runtime image_gen文生图与inpaint沿唯一journal/资产链；重复operation无新增POST/上传且复用同assetId。受管source/mask由TaskScope身份到Main registry revision绑定；64×96图中修改/保护区各3072像素逐字节符合预期，原图与蒙版不变。覆盖receipt网络前落盘、原Q/A续接/身份漂移/legacy缺receipt及落盘失败无binding泄漏。
- `test:agent-network-transition`：8项、6 loopback请求；`.diagnostics/agent-network-transition-1792729606449/report.json`。持续原生HTTP响应计入占用，未close前strict选择BUSY，双close后可切；end/error/abort无计数泄漏，真实FormData序列化等待后重检，拒绝创建socket。交叉审查发现旧curl计数未包含native传输，现已统一；Comfy HTTP/WS和公网video流也计入切换门禁。
- `test:comfyui-main`：23项；`.diagnostics/electron/comfyui-main-1792729501017/report.json`，15 fake POST/12 view/14 upload/2恢复子进程。`test:comfyui-transport`17项、`test:new-api-transport`、typecheck与view-image通过。
- 共享合同：provider16命令/13拒绝类/18调用零网络、MCP155、IPC171/168、automation、独立窗44+101、命令参考一致性通过。
- 实际Electron UI：7组/8截图、5 loopback模型POST、2次正常退出0且未强杀；`.diagnostics/agent-local-ui-2026-10-23T04-20-53-561Z/report.json`。无云账号原生导入/显式选择、同Runtime文本/tool、无工具/视觉、小context网络前拒绝、主/独立窗、重启同profile、服务断线后显式新任务恢复、托管llama.cpp与本机图片配置均实跑。初始默认cloud在选择local之前的32次请求全部命中loopback trap；选择local后cloud请求0。884×640、主/独立窗和配置截图已实际查看，内容可达。原生picker只由测试夹具代选，不称人工点击通过。

## 本地制品与安装

739个源/测试/合同文件冻结，sourceHash `d44877234bcb9f94b42ba97e78a6e357de4a2a53d745995aeca92d8526f57b13`。production `package:win:unrestricted` exit0；137个dist、199个owner与ASAR逐字节一致，production metadata/access policy及7za/三份许可核对通过，无env/diagnostics打入包。证据`.diagnostics/offline-agent-delivery/frozen-source.json`、`package.log`、`package-audit.json`。

EXE：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，110,548,480 B，SHA-256 `7908f0e8c29190b6de9bcdc89343deb01ef9146efbc02e3d3ed13177643f131a`。ASAR：53,582,799 B，SHA-256 `abb72e0b56081f11f1878d0ea95ef7d843bd67e7b10d0af284d0da3a6dfcc6b4`。不是Phase3的同名旧包。

所有同名产品实例0（UI两次正常退出0）后，品牌安装器`/S`原位升级exit0/17,230ms。注册目录`E:\sparkai-workspace\naimage`/1.0.9保留，已安装EXE与ASAR匹配；配置、凭据侧车metadata和快捷方式偏好保持，只核metadata不读真实secret。证据同目录`install.json`。

`test:bundle` exit1，仅CSS293300>270000；initialJS4375/plugin86774均在限内，诊断泄漏0，core/dist advisory超限。按AGENTS开发包规则记录，不声称正式Release门禁通过。失败试跑记录保留，不计为通过。对应源码文档提交与普通push结果见Progress和同目录delivery.json。

## 未验证边界

真实模型请求、真实服务、LAN/remote、模型/运行时下载、依赖安装均为0。真实推理质量、工具调用可靠性、视觉模型/GPU、完整第三方服务版本兼容及原生人工选择/确认尚未验证；未上传EXE、创建Release或标签。
