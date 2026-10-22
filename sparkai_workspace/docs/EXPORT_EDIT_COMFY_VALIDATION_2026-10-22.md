# 导出、项目包、AI 编辑与 ComfyUI 本地验证（2026-10-22）

本轮基于实时 main/730a176 实施，仅修改桌面与本地 Runtime。以下是实际收集的证据，历史制品与历史付费授权未复用。最终制品、安装和 Git 身份以 [Progress](../PROGRESS.md) 顶部及本轮本地交付索引为准。

用户后续收窄范围：保留已经完成的项目包视频原文件搬运兼容，不再新增视频功能或测试；以下视频测试是收窄前已经收集的证据，未再重复。

## A：图片导出

Main 队列统一图片、图片组、PSD 与 ZIP，冻结项目、来源身份/哈希及参数。默认原文件/原尺寸；原生目录授权只在 Main 保存引用。GUI、CLI/MCP 使用同一命名规则与队列，查询/取消/重试检查项目归属。图片组事务与 ZIP 原子发布保留，散图逐项报告部分成功。

- [Main 集成12组](../.diagnostics/export-queue-ipc/2026-10-22T04-28-52-248Z/report.json)：透明、重名策略、取消、部分失败、来源漂移、目标限制、历史与跨项目拒绝；另通过 queue6组、格式/集合/静态UI专项。
- [实际 Electron 4组/6截图](../.diagnostics/export-ui-2026-10-22T04-36-14-222Z/report.json)：照片alpha预览、关闭时队列running0/18而关闭后完成18 AVIF、图片组原文件ZIP与PSD、两个实际窗口共享Main队列和历史。0模型请求，正常退出0。
- 修复 Windows Sharp 文件句柄导致集合 rename 失败：有界字节快照、等待hash stream close、有限rename retry，回滚失败保留备份。

## B：可移植项目包

`.naimage` v4 使用 store ZIP32 流式容器与1MiB块，读取旧JSON v1–3。通过资产、商品与知识owner显式导出，支持图片、视频、图层、关系、参数、采用与可选会话；不复制整个私有目录。按哈希去重、逐文件CRC/SHA校验后发布；导入新项目身份并映射引用，过滤凭据、连接、活动任务回执及待执行continuation。

- [v4九组](../.diagnostics/project-package-v4/2026-10-22T04-16-28-753Z/report.json)：旧包、跨目录、知识关系、视频、大包、缺失/损坏、数量/路径/空间预检及排除执行权限；实际Electron `test:project-io` 322资产与 `test:project-knowledge` 13组通过。
- 160MiB合成视频负载（仅验证流式与字节往返，不证明真实视频解码），包167,774,081B：collect3195/write5649/open1185/import5351ms，总15,381ms；RSS由47,796,224B至122,195,968B，增长74,391,552B。此单机样本不能推导全部项目性能。
- 限制：单图32MiB、单视频512MiB、总包2GiB；不支持deflate、加密或ZIP64。分享/归档均保留媒体原始字节及EXIF；清理的是便携项目元数据，未提供媒体EXIF清理副本。

原生分享/归档/导入对话框补充检查未完成：computer-use首次捕获超时，恢复时被物理Esc停止，未产生可验收原生操作或截图；隔离测试应用正常退出0，未强杀。既有Electron项目IO与owner证据保留，不将本次空检查记为通过。

## C：AI 编辑

六入口复用唯一 `image_gen`、现有编辑器、任务/素材/成果链。扩图未开放。原图、修改区、保留主体区、标注副本保留独立身份，冻结asset/occurrence/hash/revision；新成果记录来源。选区外保护通过本地合成和像素检查，尺寸不符拒绝，不拉伸。服务器结果与本地处理元数据分源；处理失败不重新生成。

- [实际 Electron 12组/7截图](../.diagnostics/image-edit-ui-2026-10-22T04-10-11-801Z/report.json)：正常商品照片、真实涂抹坐标、缩放/平移/橡皮擦/撤销重做/反选、三角色切换、重启草稿、884×640、保护区像素、alpha及原图不变。6次loopback图片POST/0对话，两次正常退出0，截图已逐张检查。
- service12、metadata16、region-mask实际Electron owner10组及能力/蒙版专项通过。旧 `creation-ui` 在catalog adoption等待超时，未计为通过，不以本轮新UI通过掩盖该历史失败。
- [真实接口结果](../.diagnostics/image-edit-real-2026-10-22T04-14-42-848Z/completion-review.json)：本轮预算2/2用完，默认 `gpt-image-2` 的redraw/cutout各1次 `/v1/images/edits` POST，均HTTP400：“图片编辑请求无效，请检查参考图和请求格式。”0返回图、0重试、原图哈希不变。具体拒绝字段未知，不能据400断言模型不支持mask或擅改adapter。真实结果、保护合成、alpha、画质未验收。
- 两次早期预检因隔离profile缺opaque Local State而无法解密，网络POST为0；修复隔离测试环境后才执行上述两次网络请求。原配置未修改。真实验证脚本不在自动测试入口，持久预算禁止重跑。

## D：ComfyUI

复用 image-generation-service/adapter、image-operation-journal与成果入库，只连接已有localhost服务。审核模板显式映射API Format JSON节点，排除云API/未审核自定义节点，不执行脚本或自动安装依赖。模板能力决定可用操作。

- executor28、template9、Electron Main9、metadata16、recovery14子进程通过；检查system_stats/object_info、upload/image、prompt/ws、history/queue/view、依赖缺失、错误输出、资产保存。
- [实际 Electron 8组/11截图](../.diagnostics/comfyui-ui-2026-10-22T04-34-17-441Z/report.json)：4次loopback prompt POST/3view/1upload/1定向queue delete，未知提交零重发、真实重启后查询原history恢复、来源与参数、排队取消不影响其他任务、884×640表单。两次正常退出0，照片截图已检查。
- prepared在POST前、accepted prompt_id在查询前落盘；相同客户端ID不假设服务端幂等。预览不入库，运行取消缺定向中断能力时拒绝，绝不调用全局interrupt。本轮0真实ComfyUI模型执行，不能声称通用工作流兼容性、画质或性能。

## 公共与交付检查

canonical `commands.schema.json` 同步生成TS registry及命令参考，GUI/IPC/CLI/MCP118/Skill同步；IPC170/167/3、automation-service、view-image、最终typecheck与[quick GUI](../.diagnostics/electron/aidebug-2026-10-22T04-39-46-487Z/report.json)通过。Mock只证明合同、数据流和恢复控制；真实图片2次失败，真实对话/视频均0。

本轮本地交付脚本/身份报告目录：`.diagnostics/export-edit-comfy-delivery-2026-10-22/`。最终源码 `package:win:unrestricted` exit0，708源文件冻结hash `10dc7820a4ab3824436449eb9879485b37acc822d8f9b0a98fa82780e6550361`；131dist/188owner逐字节匹配。EXE 110,032,896B / SHA-256 `f05d67859272bd05bbb8040c4b56e81d4c1a5f210997d8c5b8a393a27795da00`，ASAR53,029,681B / `4ccbd7066725eebb580da2155a707e0790df39f98110222e2cd2c4bfe834bcfe`。

品牌`/S`原位安装exit0/16,132ms，E:\sparkai-workspace\naimage/1.0.9、配置及快捷方式偏好保留，安装EXE/ASAR匹配。安装前无同名实例，未强杀。凭据sidecar只核metadata，未读内容。

[最终安装版A UI](../.diagnostics/export-ui-2026-10-22T05-09-02-615Z/report.json)4组/6截图通过：正常照片与alpha预览、关闭面板后18项继续、图片组ZIP/PSD、双窗共享历史；0模型请求，正常退出0，关键截图已看。生产选择器经既有symbol-compaction owner映射；初次选择器超时属于测试定位失败，保留报告，未当成功。

73本轮文件敏感扫描0命中、无二进制，新增验证文档链接核对通过。最终Git身份见Progress和本地delivery索引；不上传EXE、不创建Release/tag，未跑正式发布全量门禁。
