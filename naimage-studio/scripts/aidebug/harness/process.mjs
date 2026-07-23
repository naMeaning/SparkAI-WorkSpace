import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export async function isHttpServerReady(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function waitForHttpServer(url, { attempts, intervalMs = 250, errorMessage } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    if (await isHttpServerReady(url)) return;
    await delay(intervalMs);
  }
  throw new Error(typeof errorMessage === "function" ? errorMessage(url) : errorMessage);
}

export async function isPortAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolvePort(true));
    });
  });
}

export async function allocateDebugPort(requestedPort = 0) {
  if (requestedPort && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error(`Invalid Electron remote debugging port: ${requestedPort}`);
  }
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      rejectPort(new Error(
        requestedPort
          ? `Electron remote debugging port ${requestedPort} is unavailable: ${error.message}`
          : `Unable to allocate an Electron remote debugging port: ${error.message}`
      ));
    });
    server.listen({ host: "127.0.0.1", port: requestedPort || 0, exclusive: true }, () => {
      const address = server.address();
      const allocated = typeof address === "object" && address ? Number(address.port) : 0;
      server.close((error) => {
        if (error) rejectPort(error);
        else if (!allocated) rejectPort(new Error("Electron remote debugging port allocation returned no port."));
        else resolvePort(allocated);
      });
    });
  });
}

export function pipeProcessLogs(child, label) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
}

export async function waitForChildExit(child, timeoutMs = 2500) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(timeoutMs).then(() => false)
  ]);
}

export async function forceKillProcessTree(pid, { isWindows = process.platform === "win32" } = {}) {
  if (!pid) return;
  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        shell: false
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process is already gone.
  }
}
