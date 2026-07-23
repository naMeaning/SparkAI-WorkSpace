import { setTimeout as delay } from "node:timers/promises";

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export class BasicCdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.done();
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        done: () => clearTimeout(timer)
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

export class DiagnosticCdpClient {
  constructor(url, {
    label = "primary",
    getPhase = () => null,
    summarizeParams = () => ({}),
    recordOperation = () => {}
  } = {}) {
    this.url = url;
    this.label = label;
    this.getPhase = getPhase;
    this.summarizeParams = summarizeParams;
    this.recordOperation = recordOperation;
    this.nextId = 1;
    this.pending = new Map();
    this.openedAt = "";
    this.closedAt = "";
    this.lastMessageAt = "";
    this.socketError = "";
  }

  async open(timeoutMs = 5000) {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP WebSocket open timed out after ${timeoutMs}ms`)), timeoutMs);
      const finish = (callback) => (event) => {
        clearTimeout(timer);
        callback(event);
      };
      this.socket.addEventListener("open", finish(resolve), { once: true });
      this.socket.addEventListener("error", finish(reject), { once: true });
    });
    this.openedAt = new Date().toISOString();
    this.socket.addEventListener("message", (event) => {
      this.lastMessageAt = new Date().toISOString();
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.done();
      const elapsedMs = Date.now() - pending.startedAtMs;
      if (message.error) {
        const error = new Error(message.error.message || JSON.stringify(message.error));
        this.recordOperation({ ...pending.operation, event: "error", at: new Date().toISOString(), elapsedMs, error: error.message });
        pending.reject(error);
      } else {
        this.recordOperation({ ...pending.operation, event: "complete", at: new Date().toISOString(), elapsedMs });
        pending.resolve(message.result ?? {});
      }
    });
    this.socket.addEventListener("error", (event) => {
      this.socketError = event?.message || "CDP WebSocket error";
      this.recordOperation({ event: "socket-error", at: new Date().toISOString(), client: this.label, error: this.socketError });
    });
    this.socket.addEventListener("close", () => {
      this.closedAt = new Date().toISOString();
      const error = new Error("CDP WebSocket closed before pending commands completed");
      for (const [id, pending] of this.pending) {
        this.pending.delete(id);
        pending.done();
        this.recordOperation({ ...pending.operation, event: "socket-closed", at: this.closedAt, elapsedMs: Date.now() - pending.startedAtMs });
        pending.reject(error);
      }
    });
    this.recordOperation({ event: "socket-open", at: this.openedAt, client: this.label, url: this.url });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    const startedAtMs = Date.now();
    const operation = {
      id,
      client: this.label,
      method,
      timeoutMs,
      phase: this.getPhase(),
      startedAt: new Date(startedAtMs).toISOString(),
      params: this.summarizeParams(method, params)
    };
    this.recordOperation({ ...operation, event: "start", at: operation.startedAt });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const elapsedMs = Date.now() - startedAtMs;
        const error = new Error(`${method} timed out after ${timeoutMs}ms`);
        error.cdpOperation = operation;
        this.recordOperation({ ...operation, event: "timeout", at: new Date().toISOString(), elapsedMs });
        reject(error);
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        operation,
        startedAtMs,
        done: () => clearTimeout(timer)
      });
      try {
        this.socket.send(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.recordOperation({ ...operation, event: "send-error", at: new Date().toISOString(), elapsedMs: Date.now() - startedAtMs, error: error instanceof Error ? error.message : String(error) });
        reject(error);
      }
    });
  }

  statusSnapshot() {
    return {
      label: this.label,
      readyState: this.socket?.readyState ?? null,
      openedAt: this.openedAt,
      closedAt: this.closedAt,
      lastMessageAt: this.lastMessageAt,
      socketError: this.socketError,
      pending: [...this.pending.values()].map((item) => ({
        id: item.operation.id,
        method: item.operation.method,
        startedAt: item.operation.startedAt,
        elapsedMs: Date.now() - item.startedAtMs,
        timeoutMs: item.operation.timeoutMs,
        phase: item.operation.phase,
        params: item.operation.params
      }))
    };
  }

  close() {
    this.socket?.close();
  }
}

export async function evaluateRuntime(client, expression, timeoutMs = 30000) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.value;
}

export function createRuntimeEvaluator({ holdAsyncIifePromises = false } = {}) {
  let holdSequence = 0;
  return async function evaluate(client, expression, timeoutMs = 30000) {
    let evaluatedExpression = expression;
    if (holdAsyncIifePromises && /^\s*\(async\s*\(/.test(String(expression || ""))) {
      const holdKey = `probe-${++holdSequence}`;
      evaluatedExpression = `(() => {
        const key = ${JSON.stringify(holdKey)};
        const store = window.__naimageCdpPromiseHolds ??= {};
        const held = Promise.resolve(${expression});
        store[key] = held;
        const release = () => setTimeout(() => { if (store[key] === held) delete store[key]; }, 0);
        held.then(release, release);
        return held;
      })()`;
    }
    return evaluateRuntime(client, evaluatedExpression, timeoutMs);
  };
}

export async function pollForDebugTarget({
  port,
  attempts,
  intervalMs = 250,
  findTarget,
  beforeAttempt,
  notFoundMessage
}) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  for (let index = 0; index < attempts; index += 1) {
    beforeAttempt?.(index);
    try {
      const targets = await fetchJson(endpoint);
      const target = findTarget(targets);
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // The caller owns the startup policy and final error wording.
    }
    await delay(intervalMs);
  }
  throw new Error(typeof notFoundMessage === "function" ? notFoundMessage() : notFoundMessage);
}

export async function waitForRuntimeExpression(client, expression, {
  evaluate = evaluateRuntime,
  timeoutMs = 15000,
  intervalMs = 250
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, expression)) return true;
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}
