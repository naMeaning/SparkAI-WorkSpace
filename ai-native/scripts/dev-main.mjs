import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const isWindows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const newApiWebDefaultDir = join("services", "ai-gateway", "new-api", "web", "default");

const children = new Set();
let closing = false;

export function buildDevMainConfig(env = process.env) {
  const gatewayPort = env.NAIMAGE_SERVER_PORT || env.IIIMAGE_SERVER_PORT || "17860";
  const frontendPort = env.NAIMAGE_WEB_PORT || env.IIIMAGE_WEB_PORT || "17862";
  const crmApiPort = env.CRM_API_PORT || "17861";
  const gatewayDataDir =
    env.AI_GATEWAY_DATA_DIR ||
    env.NAIMAGE_SERVER_DATA_DIR ||
    env.IIIMAGE_SERVER_DATA_DIR ||
    join(repoRoot, "services", "ai-gateway", "config", "new-api");
  const sqlitePath =
    env.SQLITE_PATH ||
    `${join(gatewayDataDir, "one-api.db")}?_busy_timeout=30000`;
  const crmApiBaseUrl =
    env.CRM_API_BASE_URL || `http://127.0.0.1:${crmApiPort}`;
  const newApiBaseUrl =
    env.NEW_API_BASE_URL || `http://127.0.0.1:${gatewayPort}`;
  const frontendDevUrl =
    env.NAIMAGE_WEB_URL || env.IIIMAGE_WEB_URL || `http://127.0.0.1:${frontendPort}`;
  const crmTrustSecret =
    env.CRM_EMBED_TRUST_SECRET ||
    "ai-native-crm-local-embed-secret";
  const crmStorage = (env.CRM_DEV_STORAGE || (env.CRM_DATABASE_URL ? "mysql" : "memory")).trim().toLowerCase();

  if (!["memory", "mysql"].includes(crmStorage)) {
    throw new Error("CRM_DEV_STORAGE must be memory or mysql");
  }

  const gatewayEnv = {
    NAIMAGE_SERVER_PORT: gatewayPort,
    AI_GATEWAY_DATA_DIR: gatewayDataDir,
    SQLITE_PATH: sqlitePath,
    CRM_API_BASE_URL: crmApiBaseUrl,
    CRM_EMBED_TRUST_SECRET: crmTrustSecret,
    AI_GATEWAY_FRONTEND_DEV_SERVER: "true"
  };
  const crmEnv = {
    CRM_API_PORT: crmApiPort,
    NEW_API_BASE_URL: newApiBaseUrl,
    CRM_EMBED_TRUST_SECRET: crmTrustSecret
  };
  const frontendEnv = {
    VITE_REACT_APP_SERVER_URL: newApiBaseUrl,
    RSBUILD_DEV_SERVER_PORT: frontendPort
  };

  if (crmStorage === "mysql") {
    crmEnv.CRM_DATABASE_URL = env.CRM_DATABASE_URL || "mysql://root@127.0.0.1:3306/ai_native_crm";
    crmEnv.CRM_DATABASE_NAME = env.CRM_DATABASE_NAME || "ai_native_crm";
  }

  return {
    gatewayPort,
    frontendPort,
    crmApiPort,
    gatewayDataDir,
    sqlitePath,
    crmApiBaseUrl,
    newApiBaseUrl,
    frontendDevUrl,
    crmStorage,
    gatewayEnv,
    frontendEnv,
    crmEnv,
    crmScript: crmStorage === "mysql" ? "dev" : "dev:memory",
    shouldMigrateCrm: crmStorage === "mysql"
  };
}

function prefixStream(stream, label, writer) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      writer.write(`[${label}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) writer.write(`[${label}] ${pending}\n`);
  });
}

function spawnPnpm(label, args, env) {
  const command = isWindows ? "cmd.exe" : "pnpm";
  const commandArgs = isWindows
    ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")]
    : args;
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false
  });

  children.add(child);
  prefixStream(child.stdout, label, process.stdout);
  prefixStream(child.stderr, label, process.stderr);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!closing) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      console.error(`[dev:main] ${label} exited with ${reason}`);
      shutdown(code ?? 1);
    }
  });
  child.on("error", (error) => {
    children.delete(child);
    if (!closing) {
      console.error(`[dev:main] ${label} failed to start: ${error.message}`);
      shutdown(1);
    }
  });

  return child;
}

function runPnpm(label, args, env) {
  const command = isWindows ? process.env.ComSpec || "cmd.exe" : "pnpm";
  const commandArgs = isWindows
    ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: false,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with code ${result.status ?? 1}`);
  }
}

function killTree(child) {
  if (!child.pid || child.killed) return;

  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }

  child.kill("SIGTERM");
}

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    killTree(child);
  }
  setTimeout(() => process.exit(code), 250).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

export function runDevMain(env = process.env) {
  const config = buildDevMainConfig(env);

  mkdirSync(config.gatewayDataDir, { recursive: true });

  console.log("[dev:main] starting local CRM + New API stack");
  console.log(`[dev:main] New API gateway: ${config.newApiBaseUrl}`);
  console.log(`[dev:main] Frontend dev server: ${config.frontendDevUrl}`);
  console.log(`[dev:main] CRM page: ${config.frontendDevUrl}/crm`);
  console.log(`[dev:main] CRM API: ${config.crmApiBaseUrl}`);
  console.log(`[dev:main] New API SQLite: ${config.sqlitePath}`);
  console.log(`[dev:main] CRM storage: ${config.crmStorage}`);

  if (config.shouldMigrateCrm) {
    console.log(`[dev:main] CRM MySQL: ${config.crmEnv.CRM_DATABASE_URL}`);
    runPnpm(
      "crm-api:migrate",
      ["--filter", "@ai-native/crm-api", "migrate"],
      config.crmEnv
    );
  }

  spawnPnpm(
    "gateway",
    ["--filter", "@ai-native/ai-gateway", "dev"],
    config.gatewayEnv
  );

  spawnPnpm(
    "crm-api",
    ["--filter", "@ai-native/crm-api", config.crmScript],
    config.crmEnv
  );

  spawnPnpm(
    "frontend",
    ["--dir", newApiWebDefaultDir, "run", "dev"],
    config.frontendEnv
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDevMain();
}
