import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const devUrl = "http://127.0.0.1:5173";
const remoteDebuggingPort = process.env.IIIMAGE_REMOTE_DEBUGGING_PORT || "";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repoRoot = packageRoot;
const viteCli =
  [join(packageRoot, "node_modules", "vite", "bin", "vite.js")].find((candidate) => existsSync(candidate)) ?? "";
const electronCli =
  [
    join(packageRoot, "node_modules", "electron", "cli.js"),
    join(repoRoot, "node_modules", "electron", "cli.js")
  ].find((candidate) => existsSync(candidate)) ?? "";

let vite;
let electron;
let closing = false;

async function isServerReady(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

async function waitForServer(url) {
  for (let i = 0; i < 80; i += 1) {
    if (await isServerReady(url)) return;
    await delay(250);
  }

  throw new Error(`Vite dev server did not respond: ${url}`);
}

function spawnVite() {
  if (!viteCli) {
    throw new Error("Vite CLI not found. Run pnpm install before starting iiimage Studio development mode.");
  }

  return spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "5173"], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: false
  });
}

function spawnElectron() {
  const electronArgs = remoteDebuggingPort ? [`--remote-debugging-port=${remoteDebuggingPort}`, "electron-main.cjs"] : ["electron-main.cjs"];
  if (!electronCli) {
    throw new Error("Electron CLI not found. Run pnpm install before starting iiimage Studio development mode.");
  }

  return spawn(process.execPath, [electronCli, ...electronArgs], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      IIIMAGE_DEV_URL: devUrl
    }
  });
}

function stopChildTree(child) {
  if (!child?.pid) return;
  if (isWindows) {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      shell: false,
      windowsHide: true
    });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // The child has already exited.
  }
}

function shutdown(code = 0) {
  if (closing) return;
  closing = true;

  stopChildTree(electron);
  stopChildTree(vite);
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));

try {
  if (!(await isServerReady(devUrl))) {
    vite = spawnVite();

    vite.on("error", (error) => {
      if (!closing) {
        console.error("Vite failed to start:", error);
        shutdown(1);
      }
    });

    vite.on("exit", (code) => {
      if (!closing) shutdown(code ?? 1);
    });
  } else {
    console.log(`Using existing Vite dev server: ${devUrl}`);
  }

  await waitForServer(devUrl);
  electron = spawnElectron();

  electron.on("error", (error) => {
    if (!closing) {
      console.error("Electron failed to start:", error);
      shutdown(1);
    }
  });

  electron.on("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error);
  shutdown(1);
}
