# AI-Native 第一期本地验证与交付

本期为桌面主分支开发包，范围是稳定任务回执、结构化问题共同续接与紧凑任务卡。没有调用真实图片、视频或对话模型，没有修改 New API、Extension 或生产发布渠道；EXE 不上传，不创建正式 Release/tag。

## 实现合同

Main 的 `agent-task-service` 将任务与幂等摘要写在同一原子 ledger；accepted 前必须落盘，每个 run 与问题回答先持久化一次领取。Renderer 仍拥有原 TaskScope、pending execution、保存与恢复入口。图片操作 journal 保存原远端任务、缓存字节和成果，回执仅投影这些权威状态。主/独立窗口共用同一投影及 owner。

`agent.task.start/get/wait/answer` 已同步共享 schema、CLI、MCP、Skill、命令参考和契约测试。wait 最长30秒，仅结束等待；重复提交复用原任务，异内容冲突。任务和幂等摘要不自动淘汰，2000容量满后拒绝新任务；关联图片 journal 不独立淘汰。完整字段、游标和恢复约束见[长期合同](AGENT_WORKFLOW_CONTRACT.md)。

## 本地功能证据

| 验收 | 实际证据 |
| --- | --- |
| 并发去重与唯一图片派发 | 真实隔离Electron→authenticated bridge→Main Runtime→loopback HTTP，同提交两次只有1 run和1图片POST；冲突及busy零新增 |
| 超时与重连 | 真实PowerShell CLI wait超时后，用原taskId查询；同提交查询回原任务，结果仅1node/1asset |
| 共同回答 | GUI与CLI竞争同一问题，仅续跑1次；旧问题/版本零派发；服务专项覆盖CLI领取后竞争失败 |
| 冻结范围与配置 | 问题期间清空选择并改16:9/2K/medium/n3；续跑仍原SOURCE与1:1/1K/high/n1。另首任务显式3:2/2K实际到wire |
| 重载与重启 | 等待问题重载可回答，执行中重载interrupted，正常重启原回执/成果可查，创建请求不重放 |
| 图片恢复 | image-recovery十子进程夹具1 POST/3 polls/2 downloads；accepted只恢复原taskId/本地字节，uncertain拒绝重发 |
| 隔离与异常 | task服务专项覆盖项目/会话/owner、停止迟到结果、partial、保存失败后权威保存回投、容量/损坏、accepted写失败和丢回执 |
| 回答后保存失败 | 真实阻断session原子写，GUI已领取回答后interrupted、无新模型/图片派发；旧回答不能复用，旧pending快照不能复活终结任务 |
| 双窗口可见交互 | 正式最小主窗口884×640和独立Agent窗口，问题选项/自定义回答、任务卡和重载截图；已人工检查 |
| 隐私 | DTO、ledger和UI报告断言不含fixture凭据、URL或绝对路径；恶意历史配置/node/operation文本专项先失败再修复 |

最终源码十组UI证据：[report](../.diagnostics/agent-task-ui-2026-10-18T18-04-51-531Z/report.json)，9本地模型POST、2图片POST、9截图、2次正常退出，0真实模型请求。此前九组报告及补充保存失败的失败复现保留；最终安装版以交付完成记录为准。

发送专项发现首条GUI消息未保存会话身份，已在受理前显式保存；点击、Ctrl+Enter、陈旧busy回退和真实SOURCE替换实跑通过。扩展画幅夹具发现Runtime改写Main已保存字节，使哈希失效，已保留journal原文件、哈希及实际尺寸；原direct fallback画幅行为保留。GUI准备失败不再悬留preparing，原提交保持interrupted并拒绝重放。

受影响专项已通过：agent-task、automation-service、mcp-wrapper（89工具）、ipc-registration（156/153）、task-scope、agent-workflow（11项）、agent-run-control、image-recovery、agent-window（44 service/68 sync）、image-format、view-image、typecheck。quick GUI [report](../.diagnostics/electron/aidebug-2026-10-18T17-52-03-957Z/report.json)通过。保留此前失败报告，不以静态搜索或旧EXE替代验证。

## 本地制品与Git

最终`package:win:unrestricted`exit0，production build1689 modules/22.22s，620源文件冻结hash `198d4d72f219ef43739cbc3a055623e080140de06e1605d3fd75bbf20e820057`；122dist/140owner、生产元数据与dual-access策略核对通过。EXE位于`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,879,808 B / SHA256 `9e60c32dc0cd51d446be7f3bd9db87b1fcf7864fedf631cce08899c8e901aecb`。

无同名进程后品牌安装器`/S`原位安装exit0/19,237ms；原注册目录/1.0.9与配置保留，安装EXE/ASAR匹配。凭据sidecar仅核对metadata，未读取内容。[安装版十组UI](../.diagnostics/agent-task-ui-2026-10-18T18-13-10-328Z/report.json)通过，9本地模型POST/2图片POST/9截图/两次正常退出；实际inner884×640/outer900×648，已看主/独立窗截图。测试尺寸控制改用真实`window.resizeTo`，保留失败证据，不使用Emulation模拟视口。

测试脚本适配后重新冻结/打包，最终品牌`/S`原位安装exit0/16,997ms；安装EXE SHA256 `d45228206440db83b7b426d18922a5009eda692179e38c89f6203134faff9d74`、ASAR SHA256 `6e6ee6df18bbd2b15df17e98c14a6aaf80ca7067e261fabf491f1799cff9b11a`与上述实测安装版完全相同，配置/注册目录/版本再次确认保留。[最终复核](../.diagnostics/agent-task-delivery-2026-10-19/preflight.json)确认620冻结源文件无漂移，安装器及安装内容匹配、应用进程0。此前候选均保留记录，由最终EXE替代。

41个对应源码/测试/文档文件已提交为 `3285f9153bb4de0a9277077088f9a0a1301c1035` 并普通push到origin/main；远端、HEAD及upstream实查一致，提交后工作树干净。敏感信息扫描41文件、0疑似真实凭据，14处均为已核实合成测试值；新增文档链接/差异检查通过。本完成记录随纯文档收尾提交，最终Git身份及制品/安装/验证证据哈希见[本地交付索引](../.diagnostics/agent-task-delivery-2026-10-19/delivery.json)，准确身份与历史审计入口见[Progress](../PROGRESS.md)。未提交生成物或私有配置，未上传EXE或创建正式Release/tag。

## 未验证边界

真实模型自主选择工具、内容识别、参考遵从、上游协议和实际计费均未验证；执行完成不表示视觉验收通过。首期不承诺恢复任意Agent中断位置，也不增加视觉验收、项目知识、语义检索或独立规划模型调用。既有密集画布拖动性能与正式CSS门槛未在本期解决；本地开发包不构成正式发布。
