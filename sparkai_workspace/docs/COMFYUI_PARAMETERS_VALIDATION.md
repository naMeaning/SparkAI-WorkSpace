# ComfyUI 参数能力增量验证

本轮以根仓库 main / db19822 的干净工作树为起点，仅扩展现有本机 provider。2026-10-23最终专项、新增控件实际交互、本地打包和品牌原位安装已通过；Git同步收尾中。历史D阶段证据不替代新增参数验收。

任务合同见 [Goal](../GOAL.md)，当前状态见 [Progress](../PROGRESS.md)，owner见 [上下文地图](CONTEXT_MAP.md)。

- 范围：统一normalize的steps/cfg/sampler/scheduler/denoise、审核模板能力元数据与策略hash、本机object_info脱敏能力检查、冻结参数物化和actualParams/journal、GUI/CLI/MCP有限字段。
- 保持原语义：seed=-1只解析一次；prepared在POST前、accepted在poll前持久；同提交同参数复用，异参数冲突；unknown不重发、accepted持久化失败unsafeToRetry；运行取消不得全局interrupt。恢复不依赖新的capabilitiesHash。
- 不安装或启动真实ComfyUI，不下载依赖/节点/模型，不发送真实模型请求，不支持远程/LAN或任意工作流执行；不改Extension/New API，不声称模型兼容性、画质或性能已验证。

首轮template9、executor28、Main9、automation-service、MCP118、typecheck通过。现有真实隔离Electron专项8组/11截图通过，4loopback prompt POST、3view、1upload、1定向queue delete、0真实请求，报告 `.diagnostics/comfyui-ui-2026-10-22T15-49-15-901Z/report.json`。这次首轮尚未实际操作新增采样控件，不作为其最终交互证据；后续补强结果按真实执行继续记录。

最终专项实际结果：

| 命令 | 结果与边界 |
| --- | --- |
| `corepack pnpm run test:comfyui-template` | 14组通过；schema2、策略hash、v1模板读取/再次持久化、固定映射/默认值、inspect脱敏/ranges |
| `corepack pnpm run test:comfyui-executor` | 35组通过；新增采样物化/actualParams/异步冻结、同提交唯一POST、steps/cfg/sampler等异参冲突、模板hash/策略漂移在网络前拒绝、capabilitiesHash变化恢复；32loopback prompt/3delete/4WS |
| `corepack pnpm run test:comfyui-main` | 最终10组通过；7loopback prompt/5view/1upload；requestHash冲突、journal schema2持久、旧v1记录零重发恢复。报告 `.diagnostics/electron/comfyui-main-1792685531348/report.json` |
| `corepack pnpm run test:automation-service` | 通过；生成registry/reference一致，结构化参数贯穿同一公开命令边界 |
| `corepack pnpm run test:mcp-wrapper` | 通过；118工具，共享registry及stdio |
| `corepack pnpm run typecheck` | 通过 |
| `corepack pnpm run test:view-image` | 通过；Runtime必需门禁，未新增模型请求 |
| `corepack pnpm run test:comfyui-ui` | 9组/14截图通过；实际Electron操作，未运行完整GUI/AIDebug |

最终UI报告为 `.diagnostics/comfyui-ui-2026-10-22T16-10-20-931Z/report.json`。实际表单输入steps=28、cfg=6.5、sampler=dpmpp_2m、scheduler=karras、denoise=.8，逐值核对物化KSampler、journal.actualParams、任务保存与request/response metadata。覆盖未inspect默认值提示、固定/无映射参数禁用、切模板清空旧参数、改地址清能力、原恢复对话框与定向取消、884×640最小窗；参数配置/禁用/默认值/最小窗关键截图已人工检查。4loopback prompt POST、3view、1upload、1定向delete，两次正常退出exit0，未强杀，真实模型请求0。

兼容行为：schema1审核模板可读，原hash的核实alias在再次写入schema2 store后保留；模板公开默认值从实际workflow和固定映射派生。历史snapshot schema1继续恢复，capabilitiesHash不参与恢复身份。旧Main v1 requestHash的generate重放明确返回冲突及unsafeToRetry，保留原journal并通过原恢复入口续接，不把不确定旧记录改写为新提交。

本地交付实际结果：

- `corepack pnpm run package:win:unrestricted` exit0，包含production build（1,715 modules，25.00s）。最终EXE为 `release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，110,036,992 B，SHA-256 `dda612869547ef965d1a8c306a140ff06cbace1ed41f7f459b20b630d2df2453`。
- 708个产品/测试/contract源文件冻结hash `ec6c10925c417a7936daa4963e450d57e198236814da65f1dca3647f50c544cf`；打包后复核源未变，131dist/188owner逐字节包内匹配，production package metadata、dual-access和无env/diagnostics通过。ASAR 53,052,195 B，SHA-256 `d446777a445abfd2c3492de90e8c985b4e5cf286346e8dc3a5f17e80c1e84c0a`。
- 附加`test:bundle` exit1，仅CSS预算292,392 > 270,000 B失败；initial JS4,282 B/plugin JS86,613 B在限内、无AIDebug泄漏，core async1,550,040/core JS1,554,322/dist1,997,856 B为advisory超限。遵循开发包规则记录，不进行范围外重构；未通过正式发布包体门禁。
- 品牌安装器`/S`原位升级exit0，21,030ms。启动安装器前所有同名应用实例0，未强杀；原注册目录`E:\sparkai-workspace\naimage`/1.0.9、配置与快捷方式偏好保留。已安装产品SparkAI WorkSpace/1.0.9.0，EXE/ASAR与候选包hash匹配。凭据sidecar仅核metadata，未读内容。
- 本地证据集中于 `.diagnostics/comfyui-parameters-delivery/`：`frozen-source.json`、`package.log`、`package-audit.json`、`bundle.log`、`install.json`；生成物保持忽略，不提交EXE或私有配置。Git仅提交本轮源码/测试/文档、普通push当前origin/main，完成后记录实查身份。

未运行真实ComfyUI或真实模型；本轮mock与专项不证明模型兼容性、画质、性能、所有本机节点版本或真实GPU环境。未新增依赖、安装节点/模型/ComfyUI/Python，未修改Extension/New API，未上传EXE、创建Release/tag或把本地1.0.9开发包当作公开Release。
