# Tutorial 03：用本地 CLI/MCP 控制 Agent

SparkAI WorkSpace 随安装包提供 `naimage-control` 自动化 Skill。它通过本机已认证桥接连接正在运行的桌面端，适合脚本、MCP 客户端或另一个 Agent 读取状态、发送任务和检查结果。

自动化入口不会把远端 API Key、Cookie、签名 URL、绝对素材路径或完整提示词返回给调用方。连接元数据保存在本机 Skill 目录；不要复制、提交或粘贴该文件。

## 1. 先检查桌面端

在仓库 checkout 中可以这样调用；安装版请把 `$cli` 换成“设置 → Agent”显示的 Skill 目录中的 `scripts/naimage.ps1`：

```powershell
$cli = ".\integrations\naimage-control\scripts\naimage.ps1"
& $cli status
```

`status` 会在需要时启动 SparkAI WorkSpace，并返回本机桥接是否就绪。没有安装 Skill、应用未启动或连接元数据缺失时，先在应用设置中重新安装 Skill。

## 2. 读取状态再操作

```powershell
& $cli app.state -ArgsJson '{}'
& $cli canvas.state -ArgsJson '{}'
```

先读取 `canvas.state` 可以拿到当前项目、画布版本、选中项、需求绑定和成果摘要。所有会改变画布的命令都应携带最新的项目/画布版本；如果返回版本冲突，重新读取完整状态后再规划，不能只重试旧请求中的一部分。

## 3. 发送一条自然语言任务

```powershell
$payload = '{"prompt":"基于当前选中的原图生成一张 1:1 的干净商品主图，保留主体结构和文字。","ratio":"1:1","resolution":"2K"}'
& $cli agent.chat -ArgsJson $payload
```

`agent.chat` 使用当前 Agent 会话和素材上下文。空闲时会等待本轮任务结束；任务运行中再次发送会变成文字 steer，不能在同一条 steer 中偷偷替换 SOURCE/REFERENCE。需要改素材时，用应用界面或 `agent.steer` 明确声明 `keep`、`replace`、`merge` 或 `clear`。

## 4. 什么时候使用其他命令

- `agent.new-conversation`：新建会话但保留当前画布成果。
- `agent.image-config`：打开共享图片配置，不会直接调用模型。
- `agent.pause`、`agent.resume`、`agent.stop`：控制正在运行的任务。
- `canvas.import`：把用户明确选择的本地图片复制进当前项目。
- `canvas.import-video`：只导入已有视频，不会调用视频模型。
- `canvas.generate-video`、`agent.goal`、社媒执行和电商批量执行：只有用户明确提出并确认后才调用，因为可能产生上游费用。
- `app.diagnostics`：读取脱敏诊断事件；导出诊断必须通过原生保存对话框，命令不能指定任意路径。

完整参数以 [共享命令参考](../../integrations/naimage-control/references/commands.md) 和 `commands.schema.json` 为准。GUI 与独立 Agent 窗口共用 `/goal`、`/config`、`/status`、`/help`、`/new`、`/pause`、`/resume`、`/stop`，但自动化客户端应优先使用结构化命令。

需要 MCP 时，从 Skill 目录启动 `scripts/naimage-mcp.mjs`，它与 PowerShell CLI 使用同一个 `commands.schema.json`。不要把 `--connection` 参数指向的连接文件复制到项目、日志或 MCP 配置仓库。

## 自动化隐私规则

自动化脚本只把完成任务所需的文字、明确选择的图片和参数发送给你配置的服务。脚本日志不要记录 `ArgsJson` 原文、桥接 Token、账号 Cookie、Base URL 中的敏感查询参数或本机完整路径。需要提交问题时，使用 `app.diagnostics` 的脱敏结果，并在提交前再次检查截图和日志。
