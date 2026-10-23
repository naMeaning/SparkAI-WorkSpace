# ComfyUI 托管安装专项（Phase 3）

本阶段仅修改桌面与本地 Runtime。Phase 1 连接和 Phase 2 工作流的历史证据分别保留在对应专项；本记录不将 fake 下载、stub Python 或健康检查描述为真实 ComfyUI 安装成功。最终制品与 Git 身份从 [Progress](../PROGRESS.md) 恢复。

## 实现边界

- Main 的 `managed-artifact-manifest.cjs`、`managed-artifact-store.cjs`、`comfyui-runtime-service.cjs` 与 `comfyui-runtime-archive.cjs` 分别拥有声明、流式对象存储、安装授权/版本/进程以及固定归档工具。
- 文件在应用配置目录的 `managed/artifacts` 与 `managed/comfyui`，不写项目资产。对象按 SHA-256 校验；下载 journal 保存强 ETag、进度、声明 hash 与 job 绑定，独占 Main 进程锁、持久引用及活动租约保护回收。
- 下载仅 HTTPS、公网 DNS 全地址策略与 socket pin；不使用代理、凭据、查询参数、跳转或传输压缩。loopback 例外只由测试构造函数注入，产品不读取环境绕过。
- portable adapter 固定启动声明中的 Python 与 ComfyUI 入口，只监听 loopback；不运行 manifest/workflow 提供的 pip/npm/shell。模型仅接受 checkpoint/VAE/LoRA safetensors。custom node 必须来自审核 registry 或受信 Ed25519 签名声明。
- native 导入声明或登记已有 portable 环境只预检。零网络计划显示来源、许可证、大小、依赖、GPU/显存和磁盘；下载/短时健康执行需要绑定 plan/hash 的 Main 原生确认，之后手动启动仍需单独确认。CLI/MCP 不能提交 `confirmed:true` 自行许可。
- 原项目 image journal 的未知/排队/运行任务与 executor active 共同阻止停止、移除、回滚或升级；损坏的 journal 保守阻止变更。运行中取消仍不调用全局 interrupt。
- 管理 GUI 自然懒加载；12 个公开动作沿共享 registry、IPC、CLI/MCP、Skill 与生成参考同步。公开返回只含 ID/脱敏元数据，完整 URL、路径、原始声明和凭据留 Main。

## 可安装声明

声明版本为 1、adapter 为 `comfyui-portable`。必须给出固定版本、系统/架构/GPU/显存/磁盘需求、每个制品的精确 bytes/expandedBytes/SHA-256/HTTPS URL/许可证/组件版本与许可证/依赖及受控目标目录。完整字段和验证规则由 `runtime/managed-artifact-manifest.cjs` 及其专项共同维护。

运行环境包须包含 `python_embeded/python.exe` 和 `ComfyUI/main.py`，可位于 `ComfyUI_windows_portable` 外层目录。运行依赖为审核归档，不能覆盖既有文件；custom node 只放独立托管环境的 `ComfyUI/custom_nodes/<name>`。仅模型包必须选择已登记运行环境，通过 Main 持有的模型路径配置加载，不修改用户 Python 树。官方 portable 的已知 hash 不能替代完整依赖、许可证、展开体积、GPU 要求与无跳转来源审核。

## 已执行证据

- `test:managed-artifact`：39 项通过，43 次 fake loopback GET；严格字段/路径/URL、真实 Ed25519、依赖环和 custom-node 信任、stream/hash/size、暂停/进程重启 Range/ETag、断线、错误范围、200 重启、无强 ETag 重启、TLS/认证/redirect/DNS 私网拒绝、并发下载与磁盘预留、引用/租约回收、hardlink/junction、对象篡改、原生 IO 错误脱敏。DNS等待/超时/晚到成功与失败、共享observer单方取消、SHA暂停真实fd关闭、六轮立即resume写流不重叠、同PID跨root锁隔离另有实测。报告 `.diagnostics/comfyui-workflows-delivery/managed-artifact-report.json`。
- 共享合同：automation-service、MCP 139、IPC 170/167、automation-debug 7、typecheck、生成参考一致性通过，报告 `.diagnostics/comfyui-runtime-contract/summary.json`。
- `test:comfyui-runtime`：最终39项通过，14次loopback制品GET、6次健康HTTP、20次stub Python启动，报告`.diagnostics/comfyui-runtime-1792726346136/report.json`。实际固定7za提取、恶意归档/路径/链接/大小/重标custom_nodes拒绝、激活/回滚journal写失败恢复、重复安装/移除后重装/升级兼容、进程与引用/租约、existing不改源、磁盘/人工许可迟到/连接busy/健康断线与超时均覆盖。8MiB模型复制和SHA校验中途暂停分别证明读写fd真实关闭、未读完整模型、不启动Python且无残留partial/tmp；同授权resume无新增GET并完整SHA通过。
- 最终实际 Electron UI：6 组/8 截图通过，`.diagnostics/comfyui-runtime-ui-2026-10-23T03-30-36-239Z/report.json`。实际 Main 下载/归档/安装/状态链，Python 与健康检查为 stub；原生选择/人工确认在隔离入口替换。包括零网络计划、取消许可、伪造 CLI 许可拒绝、暂停同 job/ETag 续传、已完成去重、启动停止、原 journal unknown/localhost alias/冻结身份漂移阻止停止、安装期生成在journal/网络前拒绝、已有环境不改源/去重、两次正常退出0和重启不重下载。
- `test:comfyui-main`：23 项通过，15 fake POST/12 view/14 upload/2恢复子进程；报告 `.diagnostics/electron/comfyui-main-1792726203549/report.json`。旧恢复夹具与仍运行父Main共享安装存储导致独占锁启动失败，已仅在夹具factory为installer隔离root，项目journal仍共享；未改生产锁。两个明确识别的失败测试Electron已清理，未结束用户产品实例。
- `test:view-image` 与最终 typecheck 通过。最终最小 884×640 计划和existing窗口已实际查看，内容可读、控件可达。交叉审查修复均有上述专项；失败轮次保留，不记作通过。制品身份待下方记录。

## 未验证边界

真实模型请求、真实 LAN/远程 ComfyUI、模型/运行时下载、Python/依赖安装均为 0。没有完整审核的官方可安装 bundle；GitHub/HuggingFace 常见跳转下载不在默认授权策略内。没有以 fixture 证明 GPU/驱动/VRAM、真实 portable 兼容性、真实 custom node 行为、大模型下载性能或画质。原生系统选择器及确认窗口的人工交互尚未实际点击，fixture 只证明 Main 权限边界和取消逻辑。未上传 EXE、创建 Release 或标签。

## 本地制品与安装

726源码/测试/契约文件冻结，sourceHash `1a95846c0600f4e3d6a644029507cfccf51a20b097ba7717c5311858ee64922a`。production `package:win:unrestricted` exit0；133dist/195owner、生产package metadata/access policy及7za/三份许可逐字节核对通过，无打包env或diagnostics。

EXE为`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，110,521,856 B，SHA-256 `869210fb1e220e5cf3d655eda5aa1464121279990401f8fd341c6521b3581f19`。ASAR为53,408,455 B，SHA-256 `cfdc19044ccb67cd98b44e8efc6761bf2fe4ef0946717d6540b108a64e964239`。7za为1,231,360 B / `b0cfdeaf429f5cc53f85123dd8f5a5feb92c19d31aa34df257edf9a26be05f95`。

专项两次正常退出0、所有同名产品实例0后，品牌安装器`/S`原位升级exit0/20,726ms；注册目录`E:\sparkai-workspace\naimage`/版本1.0.9保留，安装EXE/ASAR/工具均匹配，配置/凭据metadata/快捷方式偏好保持。证据`.diagnostics/comfyui-runtime-delivery/`中的package.log、package-audit.json、install.json。Bundle诊断exit1，仅CSS292969>270000；入口JS4310、plugin86613在限内，无诊断控制面泄漏。此为允许预算例外的本地开发包，未宣称正式Release门禁通过；Git身份见Progress及同目录delivery.json。
