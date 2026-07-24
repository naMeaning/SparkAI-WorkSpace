"use strict";

const { spawn } = require("node:child_process");
const { existsSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const commandAllowedList =
  "Get-Location, node --version, npm --version, pnpm --version, git status --short --branch, git branch --show-current, rg --version, rg --files [path], rg -n <pattern> <path>, Get-Content <path> -TotalCount <n>";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function splitCommandLine(command = "") {
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = null;
  while ((match = pattern.exec(String(command || "")))) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return parts;
}

function resolveCommandCwd(root, cwd) {
  const base = path.resolve(root || process.cwd());
  const requested = cwd ? path.resolve(base, String(cwd)) : base;
  const baseLower = base.toLowerCase();
  const requestedLower = requested.toLowerCase();
  if (requestedLower !== baseLower && !requestedLower.startsWith(`${baseLower}${path.sep}`)) {
    return { ok: false, error: "cwd 必须位于当前 naimage 项目目录内。", cwd: base };
  }
  if (!existsSync(requested)) return { ok: false, error: "cwd 不存在。", cwd: requested };
  return { ok: true, cwd: requested };
}

function isInsidePath(root, target) {
  const base = path.resolve(root || process.cwd());
  const resolved = path.resolve(target);
  const baseLower = base.toLowerCase();
  const resolvedLower = resolved.toLowerCase();
  return resolvedLower === baseLower || resolvedLower.startsWith(`${baseLower}${path.sep}`);
}

function resolveCommandPath(root, cwd, rawPath = ".") {
  const value = String(rawPath || ".").trim();
  if (!value || /[*?<>|"\n\r]/.test(value)) return { ok: false, error: "路径为空或包含不受控字符。" };
  const resolved = path.resolve(cwd, value);
  if (!isInsidePath(root, resolved)) return { ok: false, error: "路径必须位于当前 naimage 项目目录内。" };
  if (!existsSync(resolved)) return { ok: false, error: "路径不存在。" };
  return {
    ok: true,
    absolutePath: resolved,
    relativePath: path.relative(cwd, resolved) || "."
  };
}

function controlledCommandPlan(command = "", cwd = process.cwd(), root = cwd) {
  const clean = String(command || "").replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "缺少 command。" };
  if (/[;&|><`\n\r]/.test(clean) || /\$\(|\${/.test(clean)) {
    return { ok: false, error: "命令包含 shell 操作符或动态展开，已拒绝。" };
  }
  if (/\b(Remove-Item|rm|del|erase|rmdir|rd|Move-Item|mv|copy|cp|Set-Content|Add-Content|Out-File|New-Item|Invoke-WebRequest|curl|wget|Start-Process|Stop-Process|kill|shutdown|format|reg)\b/i.test(clean)) {
    return { ok: false, error: "当前 command 工具只允许只读诊断命令。" };
  }

  const parts = splitCommandLine(clean);
  const executable = String(parts[0] || "").toLowerCase();
  const args = parts.slice(1);
  const argText = args.join(" ").toLowerCase();

  if (["get-location", "pwd"].includes(executable) && args.length === 0) {
    return { ok: true, clean, kind: "cwd" };
  }
  if (executable === "node" && args.length === 1 && ["-v", "--version"].includes(argText)) {
    return { ok: true, clean, kind: "spawn", command: "node", args };
  }
  if (executable === "npm" && args.length === 1 && ["-v", "--version"].includes(argText)) {
    return { ok: true, clean, kind: "spawn", command: process.platform === "win32" ? "npm.cmd" : "npm", args };
  }
  if (executable === "pnpm" && args.length === 1 && ["-v", "--version"].includes(argText)) {
    return { ok: true, clean, kind: "spawn", command: process.platform === "win32" ? "pnpm.cmd" : "pnpm", args };
  }
  if (executable === "git" && (argText === "status --short --branch" || argText === "branch --show-current")) {
    return { ok: true, clean, kind: "spawn", command: "git", args };
  }
  if ((executable === "rg" || executable === "ripgrep") && argText === "--version") {
    return { ok: true, clean, kind: "spawn", command: executable, args };
  }
  if ((executable === "rg" || executable === "ripgrep") && args[0] === "--files" && args.length <= 2) {
    const target = args[1] || ".";
    const resolved = resolveCommandPath(root, cwd, target);
    if (!resolved.ok) return resolved;
    return { ok: true, clean, kind: "spawn", command: executable, args: ["--files", resolved.relativePath] };
  }
  if ((executable === "rg" || executable === "ripgrep") && args[0] === "-n" && args.length === 3) {
    const pattern = String(args[1] || "");
    if (!pattern || pattern.length > 160 || pattern.startsWith("-")) return { ok: false, error: "rg pattern 缺失或不受控。" };
    const resolved = resolveCommandPath(root, cwd, args[2]);
    if (!resolved.ok) return resolved;
    return { ok: true, clean, kind: "spawn", command: executable, args: ["-n", pattern, resolved.relativePath] };
  }
  if (executable === "get-content") {
    const totalCountIndex = args.findIndex((item) => item.toLowerCase() === "-totalcount");
    if (totalCountIndex < 0 || totalCountIndex >= args.length - 1) return { ok: false, error: "Get-Content 必须带 -TotalCount <n>。" };
    const count = Math.max(1, Math.min(Number(args[totalCountIndex + 1]) || 0, 240));
    if (!count) return { ok: false, error: "Get-Content -TotalCount 必须是 1-240 的数字。" };
    const pathArg = args.find((item, index) => index !== totalCountIndex && index !== totalCountIndex + 1 && !item.startsWith("-"));
    const resolved = resolveCommandPath(root, cwd, pathArg || "");
    if (!resolved.ok) return resolved;
    let stat = null;
    try {
      stat = statSync(resolved.absolutePath);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    if (!stat.isFile()) return { ok: false, error: "Get-Content 只允许读取文件。" };
    if (stat.size > 1024 * 1024) return { ok: false, error: "文件超过 1MB，请先用 rg 定位更小范围。" };
    return { ok: true, clean, kind: "read-file", path: resolved.absolutePath, count };
  }

  return {
    ok: false,
    error: `命令不在 allowlist 中。允许：${commandAllowedList}。`
  };
}

function clipCommandOutput(text, maxChars = 12000) {
  const value = String(text || "");
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n... command output truncated ...` : value;
}

function spawnControlledCommand(plan, cwd, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const startedAt = Date.now();
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve({ ...payload, durationMs: Date.now() - startedAt });
    };
    const child = spawn(plan.command, plan.args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1"
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Process may already have exited.
      }
    }, Math.max(250, Math.min(Number(timeoutMs) || 12000, 12000)));
    child.stdout?.on("data", (chunk) => {
      stdout = clipCommandOutput(`${stdout}${chunk}`);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = clipCommandOutput(`${stderr}${chunk}`);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, exitCode: null, signal: null, stdout, stderr, error: errorMessage(error), timedOut: false });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish({ ok: !timedOut && code === 0, exitCode: code, signal, stdout, stderr, timedOut });
    });
  });
}

async function executeControlledCommand(args = {}, root = "") {
  const command = String(args.command || "").replace(/\s+/g, " ").trim();
  const cwdResult = resolveCommandCwd(root, args.workdir ?? args.cwd);
  if (!cwdResult.ok) {
    const text = `COMMAND 已拒绝。\ncommand: ${command}\nreason: ${cwdResult.error}\nallowed: ${commandAllowedList}`;
    return { ok: false, summary: "Command rejected · cwd policy", text, error: cwdResult.error, errorCategory: "policy", retriable: false, advice: "把 cwd 限制在当前 naimage 项目目录内，或省略 cwd。" };
  }
  const plan = controlledCommandPlan(args.command, cwdResult.cwd, root);
  if (!plan.ok) {
    const text = `COMMAND 已拒绝。\ncommand: ${command}\nreason: ${plan.error}\nallowed: ${commandAllowedList}`;
    return { ok: false, summary: "Command rejected · allowlist", text, error: plan.error, errorCategory: "policy", retriable: false, advice: "改用 allowlist 中的只读诊断命令。" };
  }
  if (plan.kind === "cwd") {
    const text = `COMMAND 执行完成。\ncommand: ${command}\ncwd: ${cwdResult.cwd}\nexitCode: 0\nstdout:\n${cwdResult.cwd}`;
    return { ok: true, summary: `Command executed · ${command}`, text };
  }
  if (plan.kind === "read-file") {
    const lines = readFileSync(plan.path, "utf8").split(/\r?\n/).slice(0, plan.count).join("\n");
    const text = `COMMAND 执行完成。\ncommand: ${command}\ncwd: ${cwdResult.cwd}\nexitCode: 0\nstdout:\n${lines}`;
    return { ok: true, summary: `Command executed · ${command}`, text };
  }
  const result = await spawnControlledCommand(plan, cwdResult.cwd, args.timeout_ms ?? args.timeoutMs);
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  const text = [
    result.timedOut ? "COMMAND 执行超时。" : result.ok ? "COMMAND 执行完成。" : "COMMAND 执行失败。",
    `command: ${command}`,
    `cwd: ${cwdResult.cwd}`,
    `exitCode: ${result.exitCode ?? "null"}`,
    result.signal ? `signal: ${result.signal}` : "",
    `durationMs: ${result.durationMs}`,
    "stdout:",
    stdout || "(empty)",
    stderr ? "stderr:" : "",
    stderr
  ].filter((line) => line !== "").join("\n");
  return {
    ok: Boolean(result.ok),
    summary: result.ok ? `Command executed · ${command}` : `Command failed · ${command}`,
    text,
    error: result.ok ? undefined : (result.timedOut ? "command timed out" : result.error || stderr || `exit code ${result.exitCode}`),
    errorCategory: result.timedOut ? "timeout" : result.ok ? undefined : "command_failed",
    retriable: Boolean(result.timedOut),
    advice: result.ok ? undefined : "读取 stdout/stderr 后调整命令；不要使用写入、删除或 shell 组合命令。"
  };
}

function isExploreCommand(command) {
  return /^(rg|cat|type|ls|dir|find|grep|Get-Content|Get-ChildItem|Select-String)\b/i.test(String(command ?? "").trim());
}

module.exports = {
  commandAllowedList,
  controlledCommandPlan,
  executeControlledCommand,
  isExploreCommand,
  resolveCommandCwd,
  resolveCommandPath,
  splitCommandLine
};
