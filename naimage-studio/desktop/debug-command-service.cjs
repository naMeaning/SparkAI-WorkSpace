"use strict";

const path = require("node:path");
const {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync
} = require("node:fs");
const { spawn } = require("node:child_process");

const MAX_LOG_BYTES = 256 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_LOG_LIMIT = 100;
const DEFAULT_TEST_TIMEOUT_MS = 60_000;
const MAX_TEST_TIMEOUT_MS = 120_000;

const TARGETED_TEST_SCRIPTS = new Set([
  "typecheck",
  "test:automation-debug",
  "test:mcp-wrapper",
  "test:ipc-registration",
  "test:workspace-domain",
  "test:automation-service",
  "test:scientific-runner",
  "test:commerce-template"
]);

function commandError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details && typeof details === "object") error.details = details;
  return error;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function appendBounded(current, chunk, maximumBytes = MAX_PROCESS_OUTPUT_BYTES) {
  const next = `${current}${String(chunk || "")}`;
  const buffer = Buffer.from(next, "utf8");
  if (buffer.length <= maximumBytes) return next;
  return buffer.subarray(buffer.length - maximumBytes).toString("utf8");
}

function readFileTail(filePath, maximumBytes = MAX_LOG_BYTES) {
  if (!filePath || !existsSync(filePath)) return "";
  const descriptor = openSync(filePath, "r");
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, maximumBytes);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
    return buffer.toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

function comparablePath(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function pathInside(value, root) {
  const candidate = comparablePath(value);
  const boundary = comparablePath(root);
  return candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`);
}

function redactText(value, roots = {}) {
  let text = String(value ?? "");
  const replacements = [
    [roots.debugDir, "<diagnostics>"],
    [roots.appRoot, "<app-root>"]
  ].filter(([root]) => root).sort((left, right) => String(right[0]).length - String(left[0]).length);
  for (const [root, marker] of replacements) {
    const escaped = String(path.resolve(root)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), marker);
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:access_?token|api_?key|key|signature|sig|token)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(authorization|cookie|set-cookie|x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, "<user-home>");
}

function sanitizeValue(value, roots, depth = 0) {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value, roots).slice(0, 16_384);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeValue(item, roots, depth + 1));
  if (!isObject(value)) return String(value ?? "");
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (/(?:authorization|cookie|password|secret|api.?key|access.?token|refresh.?token|endpoint.?token)/i.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitizeValue(item, roots, depth + 1);
    }
  }
  return result;
}

function loadCommandRegistry(schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const commands = [];
  for (const section of schema.sections || []) {
    for (const command of section.commands || []) {
      commands.push({ ...command, section: section.title });
    }
  }
  return { schema, commands, byName: new Map(commands.map((command) => [command.name, command])) };
}

function invalidArgument(command, pathValue, reason, details = {}) {
  throw commandError("INVALID_ARGUMENT", `${command} 参数 ${pathValue} ${reason}。`, { path: pathValue, ...details });
}

function validateSchemaValue(command, schema, value, pathValue = "$") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    if (!isObject(value)) invalidArgument(command, pathValue, "必须是 JSON 对象");
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const name of required) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) invalidArgument(command, `${pathValue}.${name}`, "不能为空");
    }
    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(value).filter((name) => !Object.prototype.hasOwnProperty.call(properties, name));
      if (unexpected.length) invalidArgument(command, pathValue, "包含未声明字段", { unexpected });
    }
    for (const [name, item] of Object.entries(value)) {
      if (properties[name]) validateSchemaValue(command, properties[name], item, `${pathValue}.${name}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) invalidArgument(command, pathValue, "必须是数组");
    if (schema.minItems !== undefined && value.length < schema.minItems) invalidArgument(command, pathValue, `至少需要 ${schema.minItems} 项`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) invalidArgument(command, pathValue, `最多允许 ${schema.maxItems} 项`);
    value.forEach((item, index) => validateSchemaValue(command, schema.items, item, `${pathValue}[${index}]`));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") invalidArgument(command, pathValue, "必须是字符串");
    if (schema.minLength !== undefined && value.length < schema.minLength) invalidArgument(command, pathValue, `长度不能小于 ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) invalidArgument(command, pathValue, `长度不能大于 ${schema.maxLength}`);
  } else if (schema.type === "integer") {
    if (!Number.isInteger(value)) invalidArgument(command, pathValue, "必须是整数");
  } else if (schema.type === "number") {
    if (!Number.isFinite(value)) invalidArgument(command, pathValue, "必须是数字");
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    invalidArgument(command, pathValue, "必须是布尔值");
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    invalidArgument(command, pathValue, "不是允许的枚举值", { allowed: schema.enum });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) invalidArgument(command, pathValue, `不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) invalidArgument(command, pathValue, `不能大于 ${schema.maximum}`);
  }
}

function sanitizeLabel(value) {
  const normalized = String(value || "window")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "window";
}

function safeChildEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => (
    !/(?:authorization|cookie|password|secret|api.?key|access.?token|refresh.?token)/i.test(name) &&
    name !== "NAIMAGE_AIDEBUG_LIVE_IMAGE"
  )));
}

function runTargetedTest(appRoot, testName, timeoutMs, roots) {
  if (!TARGETED_TEST_SCRIPTS.has(testName)) {
    throw commandError("TARGETED_TEST_NOT_ALLOWED", `不允许执行测试脚本：${testName}`, {
      allowed: [...TARGETED_TEST_SCRIPTS]
    });
  }
  if (!existsSync(path.join(appRoot, "package.json"))) {
    throw commandError("DEBUG_ROOT_INVALID", "调试仓库根目录无效。");
  }
  const executable = process.platform === "win32" ? "corepack.cmd" : "corepack";
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(executable, ["pnpm", "run", testName], {
      cwd: appRoot,
      env: safeChildEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(commandError("TARGETED_TEST_TIMEOUT", `专项测试超时：${testName}`, {
        testName,
        timeoutMs,
        stdout: redactText(stdout, roots),
        stderr: redactText(stderr, roots)
      }));
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(commandError("TARGETED_TEST_START_FAILED", `无法启动专项测试：${testName}`, {
        testName,
        error: redactText(error.message, roots)
      }));
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        testName,
        passed: exitCode === 0,
        exitCode,
        signal: signal || null,
        durationMs: Date.now() - startedAt,
        stdout: redactText(stdout, roots),
        stderr: redactText(stderr, roots)
      };
      if (exitCode !== 0) reject(commandError("TARGETED_TEST_FAILED", `专项测试失败：${testName}`, result));
      else resolve(result);
    });
  });
}

function ipcChannels(ipcMain) {
  const invoke = ipcMain?._invokeHandlers instanceof Map
    ? [...ipcMain._invokeHandlers.keys()]
    : Object.keys(ipcMain?._invokeHandlers || {});
  const received = typeof ipcMain?.eventNames === "function"
    ? ipcMain.eventNames().map(String)
    : Object.keys(ipcMain?._events || {});
  const clean = (values) => [...new Set(values.map(String).filter((name) => name.startsWith("naimage:")))].sort();
  const invokeChannels = clean(invoke);
  const receiveChannels = clean(received);
  return {
    invokeCount: invokeChannels.length,
    receiveCount: receiveChannels.length,
    invokeChannels,
    receiveChannels
  };
}

function createDebugCommandService(options = {}) {
  const appRoot = path.resolve(String(options.appRoot || process.cwd()));
  const debugDir = path.resolve(String(options.debugDir || path.join(appRoot, ".diagnostics", "electron")));
  const electronLog = path.resolve(String(options.electronLog || path.join(debugDir, "latest.log")));
  const registry = loadCommandRegistry(options.commandSchemaPath);
  const roots = { appRoot, debugDir };
  const enabled = options.enabled === true;

  function requireEnabled(command) {
    if (enabled) return;
    throw commandError("DEBUG_COMMAND_DISABLED", `${command} 仅在本地开发或 AIDebug 模式可用。`);
  }

  function validatedArgs(command, args) {
    const definition = registry.byName.get(command);
    if (!definition || definition.surface !== "service" || !command.startsWith("debug.")) {
      throw commandError("UNSUPPORTED_SERVICE_COMMAND", `不支持的服务命令：${command}`);
    }
    const value = isObject(args) ? args : {};
    validateSchemaValue(command, definition.parameters, value);
    return value;
  }

  async function runtimeState() {
    const windows = (options.BrowserWindow?.getAllWindows?.() || []).filter((window) => !window.isDestroyed?.());
    let rendererState = null;
    let rendererError = "";
    if (typeof options.getRendererState === "function" && windows.length) {
      try {
        rendererState = sanitizeValue(await options.getRendererState(), roots);
      } catch (error) {
        rendererError = redactText(error instanceof Error ? error.message : String(error), roots);
      }
    }
    return {
      service: "naimage-debug",
      appVersion: String(options.version || ""),
      pid: process.pid,
      platform: process.platform,
      packaged: options.packaged === true,
      debugEnabled: enabled,
      registry: {
        version: registry.schema.version,
        commandCount: registry.commands.length,
        rendererCommands: registry.commands.filter((command) => command.surface === "renderer").length,
        serviceCommands: registry.commands.filter((command) => command.surface === "service").length
      },
      windows: windows.map((window) => ({
        focused: Boolean(window.isFocused?.()),
        visible: window.isVisible ? Boolean(window.isVisible()) : undefined,
        destroyed: false
      })),
      rendererState,
      ...(rendererError ? { rendererError } : {})
    };
  }

  function logEntries(limit, rendererOnly) {
    const allLines = readFileTail(electronLog).split(/\r?\n/).filter(Boolean);
    const lines = rendererOnly ? allLines.filter((line) => /\]\s+console\s+level=/i.test(line)) : allLines;
    const selected = lines.slice(-limit).map((line) => redactText(line, roots));
    return {
      source: rendererOnly ? "renderer-console" : "electron-main",
      returned: selected.length,
      availableInTail: lines.length,
      entries: selected
    };
  }

  async function captureWindow(args) {
    const windows = (options.BrowserWindow?.getAllWindows?.() || [])
      .filter((window) => !window.isDestroyed?.())
      .sort((left, right) => Number(right.isFocused?.()) - Number(left.isFocused?.()));
    const window = windows[0];
    if (!window || typeof window.capturePage !== "function") {
      throw commandError("DEBUG_WINDOW_UNAVAILABLE", "当前没有可捕获的 SparkAI WorkSpace 窗口。");
    }
    mkdirSync(debugDir, { recursive: true });
    const label = sanitizeLabel(args.label);
    const fileName = `${label}-${Date.now()}.png`;
    const filePath = path.join(debugDir, fileName);
    if (!pathInside(filePath, debugDir)) throw commandError("DEBUG_PATH_OUTSIDE_ROOT", "截图目标超出诊断目录。");
    const image = await window.capturePage();
    const png = image?.toPNG?.();
    if (!Buffer.isBuffer(png) || png.length === 0) throw commandError("DEBUG_CAPTURE_FAILED", "窗口截图返回了空图像。");
    writeFileSync(filePath, png, { flag: "wx" });
    const size = image.getSize?.() || {};
    options.log?.(`debug command capture ${fileName}`);
    return {
      fileName,
      location: `<diagnostics>/${fileName}`,
      width: Number(size.width || 0),
      height: Number(size.height || 0),
      requestedScope: args.scope || "page",
      capturedScope: "page"
    };
  }

  async function execute(command, args = {}) {
    requireEnabled(command);
    const value = validatedArgs(command, args);
    switch (command) {
      case "debug.runtime-state":
        return runtimeState();
      case "debug.renderer-logs":
        return logEntries(boundedInteger(value.limit, DEFAULT_LOG_LIMIT, 1, 500), true);
      case "debug.main-logs":
        return logEntries(boundedInteger(value.limit, DEFAULT_LOG_LIMIT, 1, 500), false);
      case "debug.run-targeted-test":
        return runTargetedTest(
          appRoot,
          String(value.testName),
          boundedInteger(value.timeoutMs, DEFAULT_TEST_TIMEOUT_MS, 1_000, MAX_TEST_TIMEOUT_MS),
          roots
        );
      case "debug.capture-window":
        return captureWindow(value);
      case "debug.inspect-ipc":
        return ipcChannels(options.ipcMain);
      case "debug.inspect-command": {
        const definition = registry.byName.get(String(value.name));
        if (!definition) throw commandError("UNKNOWN_AUTOMATION_COMMAND", `共享注册表中不存在命令：${value.name}`);
        return sanitizeValue({
          name: definition.name,
          section: definition.section,
          surface: definition.surface,
          destructive: definition.destructive === true,
          description: definition.description,
          parameters: definition.parameters || { type: "object", additionalProperties: false, properties: {} }
        }, roots);
      }
      default:
        throw commandError("UNSUPPORTED_SERVICE_COMMAND", `不支持的服务命令：${command}`);
    }
  }

  return {
    enabled,
    commands: registry.commands.filter((command) => command.surface === "service").map((command) => command.name),
    execute,
    redactText: (value) => redactText(value, roots)
  };
}

module.exports = {
  TARGETED_TEST_SCRIPTS,
  createDebugCommandService,
  redactText,
  sanitizeValue
};
