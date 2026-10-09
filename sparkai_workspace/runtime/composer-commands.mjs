// Shared by the React composer and the standalone Agent surface.
export const composerCommands = Object.freeze([
  { name: "goal", usage: "/goal 处理要求", description: "为画布图片容器设置批量目标，执行前确认范围", takesArgument: true },
  { name: "config", usage: "/config", description: "修改生图模型、比例、清晰度、数量和质量" },
  { name: "status", usage: "/status", description: "查看当前任务、素材范围和暂停状态" },
  { name: "new", usage: "/new", description: "新建会话，保留当前画布和会话历史" },
  { name: "pause", usage: "/pause", description: "暂停当前任务后续批次" },
  { name: "resume", usage: "/resume", description: "恢复已暂停的任务" },
  { name: "stop", usage: "/stop", description: "结束当前任务，操作前确认" },
  { name: "help", usage: "/help", description: "查看命令和使用说明" }
]);

export function parseComposerInput(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("/")) return { kind: "text", text };
  const [token] = text.split(/\s/, 1);
  const name = token.slice(1).toLowerCase();
  const argument = text.slice(token.length).trim();
  const command = composerCommands.find((item) => item.name === name);
  return command ? { kind: "command", name, argument } : { kind: "unknown", name };
}

export function composerCommandSuggestions(value) {
  const text = String(value || "").trimStart();
  if (!/^\/[a-z]*$/i.test(text)) return [];
  const prefix = text.slice(1).toLowerCase();
  return composerCommands.filter((command) => command.name.startsWith(prefix));
}

export function composerCommandError(input, state) {
  if (input.kind === "text") return "";
  if (input.kind === "unknown") return "未知命令，请输入 /help 查看可用命令。";
  if (input.name !== "goal" && input.argument) return `/${input.name} 不需要参数。`;
  if (["help", "status"].includes(input.name)) return "";
  if (state.stopPending) return "正在确认结束，请稍后再试。";
  if (input.name === "goal") {
    if (!input.argument) return "请输入 /goal 加上处理要求，例如 /goal 把全部商品图改为白色背景。";
    if (state.busy && !state.goalActive) return "请先结束当前任务，再设置批量目标。";
    if (!state.busy && !state.goalAvailable) return "画布暂无可执行图片容器，请先添加包含图片的容器。";
  }
  if (["pause", "resume", "stop"].includes(input.name) && !state.busy) return "当前没有运行中的任务。";
  if (input.name === "pause" && state.paused) return "任务已暂停，输入 /resume 继续。";
  if (input.name === "resume" && !state.paused) return "任务尚未暂停。";
  return "";
}
