import assert from "node:assert/strict";

import {
  AGENT_PROVIDER_OPTIONS,
  DEFAULT_ACCOUNT_BASE_URL,
  DEFAULT_UPDATE_BASE_URL,
  REASONING_EFFORT_OPTIONS,
  STORAGE_SETTINGS,
  defaultSettings,
  mergeSettings,
  readJson,
  writeJson
} from "../src/settings-persistence.ts";
assert.deepEqual(AGENT_PROVIDER_OPTIONS.map((option) => option.value), ["CODEX", "CUSTOM"]);
assert.deepEqual(REASONING_EFFORT_OPTIONS.map((option) => option.value), ["low", "medium", "high", "xhigh", "max", "ultra"]);

const migrated = mergeSettings({
  baseUrl: "https://legacy.example/v1",
  apiKey: "legacy-key",
  model: "agent-primary",
  agentModelPool: ["AGENT-PRIMARY", "agent-secondary", "agent-secondary"],
  imageModel: "image-primary",
  imageModelPool: ["IMAGE-PRIMARY", "image-secondary", ""],
  timeoutSeconds: 12.6,
  fastMode: "yes" as never
});
assert.equal(migrated.agentBaseUrl, "https://legacy.example/v1");
assert.equal(migrated.imageBaseUrl, "https://legacy.example/v1");
assert.equal(migrated.agentApiKey, "legacy-key");
assert.equal(migrated.imageApiKey, "legacy-key");
assert.equal(migrated.agentModel, "agent-primary");
assert.deepEqual(migrated.agentModelPool, ["agent-primary", "agent-secondary"]);
assert.deepEqual(migrated.imageModelPool, ["image-primary", "image-secondary"]);
assert.equal(migrated.timeoutSeconds, 15);
assert.equal(migrated.fastMode, true);
assert.equal(migrated.accountBaseUrl, DEFAULT_ACCOUNT_BASE_URL);
assert.equal(migrated.relayBaseUrl, "");
assert.equal(migrated.updateBaseUrl, DEFAULT_UPDATE_BASE_URL);

const migratedLegacyServer = mergeSettings({ serverUrl: "https://legacy-new-api.example/" });
assert.equal(migratedLegacyServer.accountBaseUrl, "https://legacy-new-api.example");
assert.equal(migratedLegacyServer.relayBaseUrl, "");
assert.equal(migratedLegacyServer.updateBaseUrl, DEFAULT_UPDATE_BASE_URL);
assert.equal((migratedLegacyServer as unknown as Record<string, unknown>).serverUrl, undefined);

const repaired = mergeSettings({
  agentProvider: "unsupported" as never,
  reasoningEffort: "extreme" as never,
  timeoutSeconds: 900,
  serverUrl: "HTTP://LOCALHOST:17860/",
  serverToken: "token",
  serverSessionCookie: "cookie",
  serverUserId: "user"
});
assert.equal(repaired.agentProvider, "CODEX");
assert.equal(repaired.reasoningEffort, "low");
assert.equal(repaired.timeoutSeconds, 600);
assert.equal(repaired.accountBaseUrl, defaultSettings.accountBaseUrl);
assert.equal(repaired.relayBaseUrl, "");
assert.equal(repaired.updateBaseUrl, defaultSettings.updateBaseUrl);
assert.equal(repaired.serverToken, "");
assert.equal(repaired.serverSessionCookie, "");
assert.equal(repaired.serverUserId, "");

const memory = new Map<string, string>();
let rejectWrites = false;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (rejectWrites) throw new Error("storage unavailable");
      memory.set(key, value);
    }
  }
});

try {
  assert.deepEqual(readJson("missing", { enabled: false }), { enabled: false });
  memory.set("object", JSON.stringify({ enabled: true, count: 3 }));
  assert.deepEqual(readJson("object", { enabled: false, name: "fallback" }), {
    enabled: true,
    name: "fallback",
    count: 3
  });
  memory.set("array", JSON.stringify(["one", "two"]));
  assert.deepEqual(readJson("array", [] as string[]), ["one", "two"]);
  memory.set("array-invalid", JSON.stringify({ one: true }));
  assert.deepEqual(readJson("array-invalid", ["fallback"]), ["fallback"]);
  memory.set("malformed", "{");
  assert.deepEqual(readJson("malformed", { safe: true }), { safe: true });

  writeJson(STORAGE_SETTINGS, { theme: "dark" });
  assert.equal(memory.get(STORAGE_SETTINGS), JSON.stringify({ theme: "dark" }));
  rejectWrites = true;
  assert.doesNotThrow(() => writeJson("blocked", { safe: true }));
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.doesNotThrow(() => writeJson("circular", circular));
} finally {
  if (originalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, cases: 34 })}\n`);
