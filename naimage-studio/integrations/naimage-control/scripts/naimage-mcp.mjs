import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const skillRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultSchemaPath = path.join(skillRoot, "references", "commands.schema.json");
const defaultConnectionPath = path.join(skillRoot, ".naimage-connection.json");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedTimeout(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.round(numeric)))
    : DEFAULT_TIMEOUT_MS;
}

export function loadAutomationTools(schemaPath = defaultSchemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const commands = (schema.sections || []).flatMap((section) => (section.commands || []).map((command) => ({
    ...command,
    section: section.title
  })));
  const byName = new Map(commands.map((command) => [command.name, command]));
  const tools = commands.map((command) => ({
    name: command.name,
    title: command.name,
    description: `${command.description}${command.surface === "service" ? " [Main service]" : " [Renderer production action]"}`,
    inputSchema: command.parameters || { type: "object", additionalProperties: false, properties: {} },
    annotations: {
      readOnlyHint: command.destructive !== true && !/\b(?:create|save|delete|remove|clear|set|execute|render|generate|import|export|select|steer|pause|resume|stop)\b/i.test(command.name),
      destructiveHint: command.destructive === true,
      idempotentHint: command.destructive !== true && /(?:\.list|\.get|\.state|\.status|\.preview|^debug\.inspect|^debug\..*-logs$)/.test(command.name),
      openWorldHint: /(?:agent\.|generate|execute|render)/.test(command.name)
    }
  }));
  return { version: schema.version, commands, byName, tools };
}

function argumentValue(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

function resolveConnectionPath(argv = process.argv.slice(2)) {
  const requested = argumentValue("--connection", argv) || process.env.NAIMAGE_CONNECTION_PATH || defaultConnectionPath;
  return path.resolve(requested);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function startNaimageIfNeeded(connection) {
  const endpointPath = path.resolve(String(connection.endpointPath || ""));
  if (existsSync(endpointPath)) return;
  const executablePath = path.resolve(String(connection.executablePath || ""));
  if (!existsSync(executablePath)) {
    throw new Error("SparkAI WorkSpace is not running and its executable could not be found. Start SparkAI WorkSpace and retry.");
  }
  const child = spawn(executablePath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false
  });
  child.unref();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForEndpoint(endpointPath, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(endpointPath)) {
      try {
        const endpoint = readJson(endpointPath, "SparkAI WorkSpace automation endpoint");
        const port = Number(endpoint.port);
        const token = String(endpoint.token || "");
        if (Number.isInteger(port) && port > 0 && port <= 65_535 && token) {
          return { host: "127.0.0.1", port, token };
        }
      } catch {
        // The application may still be atomically replacing endpoint.json.
      }
    }
    await wait(200);
  }
  throw new Error("SparkAI WorkSpace automation endpoint did not become ready within 30 seconds.");
}

async function resolveEndpoint(connectionPath) {
  const connection = readJson(connectionPath, "SparkAI WorkSpace connection metadata");
  if (!connection.endpointPath) throw new Error("SparkAI WorkSpace connection metadata does not contain endpointPath.");
  startNaimageIfNeeded(connection);
  return waitForEndpoint(path.resolve(String(connection.endpointPath)));
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`SparkAI WorkSpace returned non-JSON HTTP ${response.status}.`);
    }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(String(payload?.error || `SparkAI WorkSpace returned HTTP ${response.status}.`));
      if (payload?.code) error.code = String(payload.code);
      if (isObject(payload?.details)) error.details = payload.details;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeAutomationTool(name, args, options = {}) {
  const registry = options.registry || loadAutomationTools(options.schemaPath);
  const command = registry.byName.get(name);
  if (!command) throw new Error(`Unknown SparkAI WorkSpace automation command: ${name}`);
  if (!isObject(args)) throw new Error("Tool arguments must be a JSON object.");
  const timeoutMs = boundedTimeout(options.timeoutMs ?? args.timeoutMs);
  const endpoint = options.endpoint || await resolveEndpoint(options.connectionPath || defaultConnectionPath);
  const baseUrl = `http://127.0.0.1:${endpoint.port}/v1`;
  const headers = { authorization: `Bearer ${endpoint.token}` };
  if (name === "status") {
    return requestJson(`${baseUrl}/status`, { method: "GET", headers }, Math.min(timeoutMs, 60_000));
  }
  return requestJson(`${baseUrl}/execute`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ command: name, args, timeoutMs })
  }, timeoutMs);
}

function toolText(value) {
  return JSON.stringify(value, null, 2);
}

function errorPayload(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...(typeof error?.code === "string" && error.code ? { code: error.code } : {}),
    ...(isObject(error?.details) ? { details: error.details } : {})
  };
}

export function createMcpRequestHandler(options = {}) {
  const registry = options.registry || loadAutomationTools(options.schemaPath);
  const connectionPath = options.connectionPath || defaultConnectionPath;
  return async function handle(message) {
    const method = String(message?.method || "");
    if (method === "initialize") {
      return {
        protocolVersion: typeof message?.params?.protocolVersion === "string"
          ? message.params.protocolVersion
          : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "naimage-control", version: String(registry.version || 1) },
        instructions: "Use the shared SparkAI WorkSpace command registry. Inspect state before mutations and preserve explicit charge/destructive authorization boundaries."
      };
    }
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: registry.tools };
    if (method === "tools/call") {
      const name = String(message?.params?.name || "");
      const args = isObject(message?.params?.arguments) ? message.params.arguments : {};
      try {
        const payload = await invokeAutomationTool(name, args, {
          registry,
          connectionPath,
          endpoint: options.endpoint,
          timeoutMs: message?.params?._meta?.timeoutMs
        });
        const result = payload?.result ?? payload;
        return {
          content: [{ type: "text", text: toolText(result) }],
          structuredContent: isObject(result) ? result : { value: result },
          isError: false
        };
      } catch (error) {
        const payload = errorPayload(error);
        return {
          content: [{ type: "text", text: toolText(payload) }],
          structuredContent: payload,
          isError: true
        };
      }
    }
    if (method.startsWith("notifications/")) return undefined;
    const error = new Error(`Method not found: ${method}`);
    error.rpcCode = -32601;
    throw error;
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function runMcpServer(options = {}) {
  const handler = createMcpRequestHandler(options);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of input) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    if (message.id === undefined) {
      try { await handler(message); } catch { /* Notifications never receive a response. */ }
      continue;
    }
    try {
      const result = await handler(message);
      writeMessage({ jsonrpc: "2.0", id: message.id, result: result ?? {} });
    } catch (error) {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: Number(error?.rpcCode || -32603),
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runMcpServer({ connectionPath: resolveConnectionPath() }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
