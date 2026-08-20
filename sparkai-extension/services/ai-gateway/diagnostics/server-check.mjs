import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, "..");
const repoRoot = resolve(serverRoot, "..", "..");
const newApiRoot = join(serverRoot, "new-api");
const frontendRoot = join(newApiRoot, "web", "default");
const diagnosticsRoot = join(serverRoot, ".diagnostics");
const outputDir = join(diagnosticsRoot, "server-check");
const dataDir = join(outputDir, "data");
const reportPath = join(outputDir, "report.md");
const reportJsonPath = join(outputDir, "report.json");
const results = [];

function ensureCleanOutput() {
  const resolved = resolve(outputDir);
  const diagnosticsResolved = resolve(diagnosticsRoot);
  const diagnosticsPrefix = diagnosticsResolved.endsWith(sep) ? diagnosticsResolved : `${diagnosticsResolved}${sep}`;
  if (resolved !== diagnosticsResolved && !resolved.startsWith(diagnosticsPrefix)) {
    throw new Error(`Refuse to clean path outside diagnostics output: ${resolved}`);
  }
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
}

function record(name, ok, detail = "", meta = {}) {
  const item = {
    name,
    status: ok ? "OK" : "FAIL",
    detail: String(detail || ""),
    meta,
    time: new Date().toISOString()
  };
  results.push(item);
  console.log(`[${item.status}] ${name}${detail ? ` - ${String(detail).slice(0, 240)}` : ""}`);
}

function markdownEscape(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\r", "")
    .replaceAll("\n", "<br>");
}

function writeReport() {
  const ok = results.every((item) => item.status === "OK");
  const lines = [
    "# AI Gateway Diagnostics",
    "",
    `生成时间：${new Date().toISOString()}`,
    `服务端根目录：${serverRoot}`,
    `后端接管：New API`,
    `总状态：${ok ? "OK" : "FAIL"}`,
    "",
    "| status | check | detail |",
    "| --- | --- | --- |",
    ...results.map((item) => `| ${item.status} | ${markdownEscape(item.name)} | ${markdownEscape(item.detail)} |`),
    "",
    "## Meta",
    "",
    "```json",
    JSON.stringify(results, null, 2),
    "```"
  ];
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(reportJsonPath, `${JSON.stringify({ ok, results }, null, 2)}\n`, "utf8");
  return ok;
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function quote(arg) {
  const value = String(arg);
  if (!/[ \t"&|<>^]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const shellCommand = process.platform === "win32" && (command === "npm" || command === "npx" || command === "pnpm");
  const result = shellCommand
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `${command} ${args.map(quote).join(" ")}`], {
        cwd: options.cwd || serverRoot,
        env: { ...process.env, ...(options.env || {}) },
        encoding: "utf8",
        timeout: options.timeout || 120000
      })
    : spawnSync(command, args, {
        cwd: options.cwd || serverRoot,
        env: { ...process.env, ...(options.env || {}) },
        encoding: "utf8",
        timeout: options.timeout || 120000
      });
  return {
    command: `${command} ${args.join(" ")}`,
    status: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? String(result.error.message || result.error) : ""
  };
}

function requiredLayout() {
  return [
    join(serverRoot, "server.cjs"),
    join(serverRoot, "package.json"),
    join(newApiRoot, "main.go"),
    join(newApiRoot, "go.mod"),
    join(newApiRoot, "vendor", "modules.txt"),
    join(newApiRoot, "web", "package.json"),
    join(newApiRoot, "web", "node_modules"),
    join(frontendRoot, "dist", "index.html"),
    join(newApiRoot, "bin", process.platform === "win32" ? "naimage-new-api.exe" : "naimage-new-api")
  ];
}

function scanExternalNewApiReferences() {
  const externalNewApi = join(repoRoot, "new-api");
  const needles = [externalNewApi, externalNewApi.replaceAll("\\", "/")];
  const files = [
    join(serverRoot, "server.cjs"),
    join(serverRoot, "package.json"),
    join(serverRoot, "diagnostics", "server-check.mjs"),
    join(frontendRoot, "package.json")
  ];
  const hits = [];

  for (const file of files) {
    if (!existsSync(file) || statSync(file).size > 2_000_000) continue;
    const text = readText(file);
    for (const needle of needles) {
      if (text.includes(needle)) {
        hits.push(`${relative(repoRoot, file)} -> ${needle}`);
      }
    }
  }
  return hits;
}

async function requestText(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { response, text };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function requestJson(base, endpoint, options = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  return { response, text, data: parseJson(text) };
}

function extractSessionCookie(response) {
  const values = [];
  if (typeof response.headers.getSetCookie === "function") values.push(...response.headers.getSetCookie());
  const single = response.headers.get("set-cookie");
  if (single) values.push(single);
  for (const value of values) {
    const match = String(value || "").match(/(?:^|,\s*)(session=[^;,\s]+)/i);
    if (match) return match[1];
  }
  return "";
}

function tokenItems(payload) {
  const source = payload?.data ?? payload;
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.items)) return source.items;
  if (Array.isArray(source?.Items)) return source.Items;
  if (Array.isArray(source?.data)) return source.data;
  return [];
}

async function runNewApiAuthContract(base) {
  const suffix = `${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;
  const username = `ad${suffix}`.slice(0, 20);
  const password = `pw${suffix}88`.slice(0, 20);
  const register = await requestJson(base, "/api/user/register", {
    method: "POST",
    body: { username, password, display_name: "Diagnostics" }
  });
  if (!register.response.ok || register.data.success !== true) {
    throw new Error(`register failed ${register.response.status}: ${register.text.slice(0, 400)}`);
  }

  const login = await requestJson(base, "/api/user/login", {
    method: "POST",
    body: { username, password }
  });
  const session = extractSessionCookie(login.response);
  const userId = String(login.data?.data?.id || "");
  if (!login.response.ok || login.data.success !== true || !session || !userId) {
    throw new Error(`login failed status=${login.response.status} userId=${userId || "missing"} session=${session ? "yes" : "no"} body=${login.text.slice(0, 400)}`);
  }

  const authHeaders = { Cookie: session, "New-Api-User": userId };
  const self = await requestJson(base, "/api/user/self", { headers: authHeaders });
  if (!self.response.ok || self.data.success !== true || String(self.data?.data?.id || "") !== userId) {
    throw new Error(`self failed ${self.response.status}: ${self.text.slice(0, 400)}`);
  }

  let list = await requestJson(base, "/api/token/?p=1&size=100", { headers: authHeaders });
  if (!list.response.ok || list.data.success !== true) {
    throw new Error(`token list failed ${list.response.status}: ${list.text.slice(0, 400)}`);
  }
  let tokens = tokenItems(list.data);
  let token = tokens.find((item) => item?.group === "default" && /naimage/i.test(String(item?.name || "")));
  if (!token) {
    const add = await requestJson(base, "/api/token/", {
      method: "POST",
      headers: authHeaders,
      body: { name: "naimage Default", expired_time: -1, remain_quota: 500000, unlimited_quota: true, group: "default" }
    });
    if (!add.response.ok || add.data.success !== true) {
      throw new Error(`token add failed ${add.response.status}: ${add.text.slice(0, 400)}`);
    }
    list = await requestJson(base, "/api/token/?p=1&size=100", { headers: authHeaders });
    tokens = tokenItems(list.data);
    token = tokens.find((item) => item?.group === "default" && /naimage/i.test(String(item?.name || "")));
  }
  if (!token?.id) throw new Error(`default token missing after ensure; tokens=${JSON.stringify(tokens).slice(0, 400)}`);

  const key = await requestJson(base, `/api/token/${token.id}/key`, {
    method: "POST",
    headers: authHeaders
  });
  const fullKey = String(key.data?.data?.key || key.data?.key || "");
  if (!key.response.ok || key.data.success !== true || fullKey.length < 16) {
    throw new Error(`token key failed ${key.response.status}: ${key.text.slice(0, 400)}`);
  }
  return { username, userId, tokenId: token.id, tokenGroup: token.group, keyPrefix: fullKey.slice(0, 8), tokenCount: tokens.length };
}

async function waitForStatus(base, timeoutMs = 25000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${base}/api/status`);
      const text = await response.text();
      if (response.ok) {
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { raw: text };
        }
        return { response, text, data };
      }
      lastError = new Error(`/api/status ${response.status}: ${text.slice(0, 200)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  throw lastError || new Error(`Timeout waiting for ${base}/api/status`);
}

async function startNewApiContractCheck() {
  const port = 19100 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NAIMAGE_SERVER_PORT: String(port),
      AI_GATEWAY_DATA_DIR: dataDir,
      GIN_MODE: "release"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const logs = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  try {
    const status = await waitForStatus(base);
    const home = await requestText(`${base}/`);
    const authContract = await runNewApiAuthContract(base);
    return {
      ok: status.response.ok && home.response.ok && /html/i.test(home.response.headers.get("content-type") || ""),
      detail: `/api/status=${status.response.status}, /=${home.response.status}, auth/key=OK, pid=${child.pid}`,
      meta: {
        base,
        status: status.data,
        authContract,
        homeContentType: home.response.headers.get("content-type") || "",
        logs: logs.join("").slice(-4000)
      }
    };
  } finally {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { encoding: "utf8" });
    } else {
      child.kill("SIGTERM");
    }
    await delay(350);
  }
}

async function main() {
  ensureCleanOutput();

  const packageJson = readText(join(serverRoot, "package.json"));
  const serverSource = readText(join(serverRoot, "server.cjs"));
  const missing = requiredLayout().filter((item) => !existsSync(item));
  record("new-api-layout", missing.length === 0, missing.length ? `缺失：${missing.join(", ")}` : "New API source, web deps, dist, vendor and binary are embedded.");
  record(
    "old-server-removed",
    !existsSync(join(serverRoot, "legacy-iiimage-server.cjs")) &&
      !existsSync(join(serverRoot, "legacy-naimage-server.cjs")) &&
      !existsSync(join(serverRoot, "public")) &&
      !packageJson.includes("legacy-iiimage-server") &&
      !packageJson.includes("legacy-naimage-server"),
    "legacy server entry, old public UI and legacy npm script must be removed."
  );
  record(
    "launcher-contract",
    serverSource.includes("backend: \"new-api\"") &&
      serverSource.includes("new-api") &&
      serverSource.includes("-mod=vendor") &&
      serverSource.includes("AI Gateway now runs embedded New API"),
    "server.cjs must be a New API launcher and build from vendored Go dependencies."
  );

  const syntax = run("node", ["--check", "server.cjs"], { timeout: 30000 });
  record("server-syntax", syntax.status === 0, syntax.stdout || syntax.stderr || syntax.error, syntax);

  const smoke = run("pnpm", ["run", "smoke"], { timeout: 60000 });
  let smokeJson = {};
  try {
    smokeJson = JSON.parse(smoke.stdout.match(/\{[\s\S]*\}/)?.[0] || "{}");
  } catch {
    smokeJson = {};
  }
  record(
    "new-api-smoke",
    smoke.status === 0 &&
      smokeJson.ok === true &&
      smokeJson.backend === "new-api" &&
      smokeJson.frontendReady === true &&
      smokeJson.binaryReady === true &&
      smokeJson.vendorReady === true &&
      smokeJson.webNodeModulesReady === true,
    smoke.stdout || smoke.stderr || smoke.error,
    { smoke, smokeJson }
  );

  const externalHits = scanExternalNewApiReferences();
  record(
    "no-external-new-api-path",
    externalHits.length === 0,
    externalHits.length ? externalHits.join("; ") : "No runtime/debug file references a repo-level new-api outside services/ai-gateway/new-api."
  );

  try {
    const contract = await startNewApiContractCheck();
    record("new-api-runtime", contract.ok, contract.detail, contract.meta);
  } catch (error) {
    record("new-api-runtime", false, error instanceof Error ? error.stack || error.message : String(error));
  }

  const ok = writeReport();
  console.log(JSON.stringify({ ok, reportPath, reportJsonPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  record("fatal", false, error instanceof Error ? error.stack || error.message : String(error));
  writeReport();
  console.error(error);
  process.exitCode = 1;
});
