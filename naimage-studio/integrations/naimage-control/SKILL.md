---
name: naimage-control
description: Control the local naimage desktop app through its authenticated automation CLI. Use when an agent needs to inspect or operate naimage projects, canvas nodes, image containers, selections, conversations, image generation, imports, or Agent tasks; also use for requests such as “在 naimage 里生成图片”, “查看画布”, “选择或删除节点”, “切换项目”, or “让 naimage Agent 完成任务”.
---

# naimage Control

Use the bundled PowerShell CLI. Resolve paths relative to this Skill directory.

## Workflow

1. Run `scripts/naimage.ps1 status` before issuing a command. The script starts naimage when necessary.
2. Run `canvas.state` or `project.list` before changing existing work.
3. Prefer `agent.chat` for natural-language image work; use direct canvas commands for deterministic project and selection operations.
4. Re-read `canvas.state` after a mutating command and report the actual result.
5. Require explicit user authorization before `canvas.clear`, `canvas.delete-selected`, overwriting a project name, or exporting/deleting user assets.

Pass command arguments as compact JSON:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.state
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.chat -ArgsJson '{"prompt":"生成三张暖黄色跨境电商主图"}' -TimeoutSeconds 900
```

Read [references/commands.md](references/commands.md) for command schemas and response fields.

## Safety

- Never read, print, copy, or persist `.naimage-connection.json` or the automation endpoint token.
- Never edit naimage project files directly while the app is running. Use the CLI so renderer state and persistence stay synchronized.
- Treat returned local asset paths as user data. Do not modify source images outside naimage-managed project storage.
- Retry a `renderer not ready` response briefly; do not start duplicate app processes repeatedly.
