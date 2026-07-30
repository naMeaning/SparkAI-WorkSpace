"use strict";

const { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const LEGACY_MEMORY_DATABASE_NAME = "iiimage-memory.db";

let DatabaseSync = null;
let sqliteLoadError = null;

try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  sqliteLoadError = error;
}

function readJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function localSafeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: "json stringify failed" });
  }
}

function createMemoryStore(options = {}) {
  const configRoot = options.configRoot;
  if (!configRoot) throw new Error("createMemoryStore requires configRoot");

  const safeJson = typeof options.safeJson === "function" ? options.safeJson : localSafeJson;
  const summarizeText = options.summarizeText;
  const toolSummary = options.toolSummary;
  const promptTextStoreFromRaw = options.promptTextStoreFromRaw;
  const promptStoreStatus = options.promptStoreStatus;
  const validateEditableText = options.validateEditableText;
  const sanitizeFastMemoryText = options.sanitizeFastMemoryText;
  const selectFastMemoryPromptContext = options.selectFastMemoryPromptContext;
  const sanitizeModelVisibleToolText = options.sanitizeModelVisibleToolText;
  const parseJsonObject = options.parseJsonObject;
  const splitKeywords = options.splitKeywords;
  const countLines = options.countLines;
  const dateKey = options.dateKey;
  const compactDateKey = options.compactDateKey;
  const experiencePublicArgumentKeys = options.experiencePublicArgumentKeys || new Set();
  const defaultMainAgentPrompt = String(options.defaultMainAgentPrompt || "");
  const defaultMemoryAgentPrompt = String(options.defaultMemoryAgentPrompt || "");
  const defaultMainAgentPromptRevision = Number(options.defaultMainAgentPromptRevision || 0);
  const defaultMainAgentPromptHash = String(options.defaultMainAgentPromptHash || "");
  const promptTextContractRevision = Number(options.promptTextContractRevision || 0);
  const visibleToolChars = Number(options.visibleToolChars || 6000);
  const dateMemoryCompactChars = Number(options.dateMemoryCompactChars || 200000);
  const mainAgentPromptMaxChars = Number(options.mainAgentPromptMaxChars || 100000);
  const scopedFastMemoryMaxChars = Number(options.scopedFastMemoryMaxChars || 64000);
  const fastMemoryPromptMaxChars = Number(options.fastMemoryPromptMaxChars || 12000);
  const protocolHistoryMaxTurns = Number(options.protocolHistoryMaxTurns || 36);
  const protocolHistoryPromptChars = Number(options.protocolHistoryPromptChars || 180000);
  const protocolHistoryStoreChars = Number(options.protocolHistoryStoreChars || 260000);

  const memoryDir = path.join(configRoot, "memory");
  const canonicalDbPath = path.join(memoryDir, "naimage-memory.db");
  const legacyDbPath = path.join(memoryDir, LEGACY_MEMORY_DATABASE_NAME);
  const dateMemoryPath = path.join(memoryDir, "datememorycontext.json");
  const promptMemoryPath = path.join(memoryDir, "promptcontext.json");
  const fastMemoryPath = path.join(memoryDir, "fastmemory.json");
  const memoryContextPath = path.join(memoryDir, "memorycontext.json");
  let dbPath = canonicalDbPath;
  let db = null;

  function migrateLegacyMemoryDatabase() {
    if (existsSync(canonicalDbPath) || !existsSync(legacyDbPath)) return;
    const migrationPath = `${canonicalDbPath}.legacy-migration-${process.pid}`;
    try {
      copyFileSync(legacyDbPath, migrationPath, constants.COPYFILE_EXCL);
      renameSync(migrationPath, canonicalDbPath);
    } catch {
      try { rmSync(migrationPath, { force: true }); } catch {}
      if (!existsSync(canonicalDbPath)) dbPath = legacyDbPath;
    }
  }

  function ensureMemory() {
    mkdirSync(memoryDir, { recursive: true });
    migrateLegacyMemoryDatabase();

    if (!existsSync(dateMemoryPath)) {
      writeJson(dateMemoryPath, {
        version: 1,
        next_entry_id: 1,
        needs_compaction: false,
        entries: []
      });
    }
    if (!existsSync(promptMemoryPath)) {
      writeJson(promptMemoryPath, {
        version: 2,
        format: "plain-text",
        contractRevision: promptTextContractRevision,
        mainPrompt: defaultMainAgentPrompt,
        memoryPrompt: defaultMemoryAgentPrompt,
        baseDefaultPromptRevision: defaultMainAgentPromptRevision,
        baseDefaultPromptHash: defaultMainAgentPromptHash,
        updatedAt: new Date().toISOString()
      });
    } else {
      const migrated = promptTextStoreFromRaw(readJson(promptMemoryPath, { version: 1, entries: [] }));
      if (migrated.changed) writeJson(promptMemoryPath, migrated.store);
    }
    if (!existsSync(fastMemoryPath)) writeJson(fastMemoryPath, { version: 1, entries: [] });
    if (!existsSync(memoryContextPath)) writeJson(memoryContextPath, { version: 1, entries: [] });

    if (!DatabaseSync) {
      throw new Error(`node:sqlite unavailable: ${sqliteLoadError?.message ?? "unknown error"}`);
    }

    if (!db) {
      db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_entries (
          entry_id TEXT PRIMARY KEY,
          order_index INTEGER NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          text TEXT NOT NULL,
          date_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          chars INTEGER NOT NULL,
          lines INTEGER NOT NULL,
          status TEXT NOT NULL,
          compact_of TEXT,
          tool_ref TEXT
        );
        CREATE TABLE IF NOT EXISTS context_entries (
          entry_id TEXT PRIMARY KEY,
          order_index INTEGER NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          text TEXT NOT NULL,
          date_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          chars INTEGER NOT NULL,
          lines INTEGER NOT NULL,
          status TEXT NOT NULL,
          compact_of TEXT,
          tool_ref TEXT
        );
        CREATE TABLE IF NOT EXISTS date_memory (
          date_key TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          chars INTEGER NOT NULL,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          keywords TEXT,
          entry_ids TEXT
        );
        CREATE TABLE IF NOT EXISTS tool_memory (
          entry_id TEXT PRIMARY KEY,
          tool_name TEXT NOT NULL,
          call_json TEXT NOT NULL,
          result_text TEXT NOT NULL,
          visible_output TEXT NOT NULL,
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL,
          chars INTEGER NOT NULL,
          lines INTEGER NOT NULL,
          externalized INTEGER NOT NULL
        );
      `);
      for (const sql of [
        "ALTER TABLE date_memory ADD COLUMN keywords TEXT",
        "ALTER TABLE date_memory ADD COLUMN entry_ids TEXT"
      ]) {
        try {
          db.exec(sql);
        } catch {
          // Column already exists in newer stores.
        }
      }
    }
  }

  function getNextSequence() {
    ensureMemory();
    const row = db.prepare("SELECT value FROM runtime_meta WHERE key = 'next_entry_sequence'").get();
    const next = Number(row?.value ?? "1");
    db.prepare(
      "INSERT INTO runtime_meta(key, value) VALUES('next_entry_sequence', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(String(next + 1));
    return next;
  }

  function runtimeMetaJson(key, fallback = null) {
    ensureMemory();
    const row = db.prepare("SELECT value FROM runtime_meta WHERE key = ?").get(String(key));
    if (!row?.value) return fallback;
    try {
      const parsed = JSON.parse(String(row.value));
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeRuntimeMetaJson(key, value) {
    ensureMemory();
    db.prepare("INSERT INTO runtime_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(key), safeJson(value));
  }

  function compactScopeId(value = "default") {
    return String(value || "default").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 96) || "default";
  }

  function externalScopeValue(value = "") {
    return String(value || "").trim().slice(0, 160);
  }

  function externalScopeFromInput(input = {}) {
    return {
      projectId: externalScopeValue(input.projectId),
      conversationId: externalScopeValue(input.conversationId)
    };
  }

  function externalEntryMatchesScope(target, entry = {}, input = {}) {
    if (target !== "fastmemory") return true;
    const scope = externalScopeFromInput(input);
    if (!scope.projectId && !scope.conversationId) return true;
    if (scope.projectId && externalScopeValue(entry.projectId) !== scope.projectId) return false;
    if (scope.conversationId && externalScopeValue(entry.conversationId) !== scope.conversationId) return false;
    return true;
  }

  function conversationSummaryKey(payload = {}) {
    return `conversation_summary:${compactScopeId(payload.projectId)}:${compactScopeId(payload.conversationId)}`;
  }

  function conversationProtocolKey(payload = {}) {
    return `conversation_protocol:${compactScopeId(payload.projectId)}:${compactScopeId(payload.conversationId)}`;
  }

  function makeEntryId(prefix = "ent") {
    return `${prefix}-${compactDateKey(dateKey())}-${String(getNextSequence()).padStart(6, "0")}`;
  }

  function nextOrderIndex() {
    ensureMemory();
    const row = db.prepare("SELECT COALESCE(MAX(order_index), 0) AS max_order FROM context_entries").get();
    return Number(row?.max_order ?? 0) + 1;
  }

  function externalStorePath(target) {
    return target === "memorycontext" ? memoryContextPath : fastMemoryPath;
  }

  function readPromptTextStore() {
    ensureMemory();
    const migrated = promptTextStoreFromRaw(readJson(promptMemoryPath, {}));
    if (migrated.changed) writeJson(promptMemoryPath, migrated.store);
    return migrated.store;
  }

  function writePromptTextStore(store) {
    const normalized = promptTextStoreFromRaw({
      version: 2,
      format: "plain-text",
      contractRevision: promptTextContractRevision,
      mainPrompt: store?.mainPrompt,
      memoryPrompt: store?.memoryPrompt,
      baseDefaultPromptRevision: store?.baseDefaultPromptRevision,
      baseDefaultPromptHash: store?.baseDefaultPromptHash,
      updatedAt: store?.updatedAt || new Date().toISOString()
    }).store;
    writeJson(promptMemoryPath, normalized);
    return normalized;
  }

  function readExternalStore(target) {
    const fallback = { version: 1, entries: [] };
    const store = readJson(externalStorePath(target), fallback);
    return {
      version: 1,
      entries: Array.isArray(store.entries)
        ? store.entries
            .filter((entry) => entry && typeof entry === "object")
            .map((entry, index) => ({
              entry_id: String(entry.entry_id || `${target}-${index + 1}`),
              order_index: Number(entry.order_index || index + 1),
              section: String(entry.section || (target === "memorycontext" ? "private" : "surface")),
              title: String(entry.title || "entry"),
              text: String(entry.text || ""),
              status: String(entry.status || "active"),
              keywords: splitKeywords(entry.keywords),
              created_at: String(entry.created_at || new Date().toISOString()),
              updated_at: String(entry.updated_at || entry.created_at || new Date().toISOString()),
              compact_of: Array.isArray(entry.compact_of) ? entry.compact_of.map(String) : [],
              projectId: externalScopeValue(entry.projectId),
              conversationId: externalScopeValue(entry.conversationId)
            }))
        : fallback.entries
    };
  }

  function writeExternalStore(target, store) {
    const entries = Array.isArray(store.entries) ? store.entries : [];
    writeJson(externalStorePath(target), {
      version: 1,
      entries: entries.map((entry, index) => ({ ...entry, order_index: Number(entry.order_index || index + 1) }))
    });
  }

  function nextExternalOrder(store) {
    return Math.max(0, ...store.entries.map((entry) => Number(entry.order_index || 0))) + 1;
  }

  function resolveExternalSelector(target, selector, section = "", input = {}) {
    const store = readExternalStore(target);
    const activeEntries = store.entries.filter((entry) =>
      entry.status === "active" && (!section || entry.section === section) && externalEntryMatchesScope(target, entry, input)
    );
    const raw = String(selector || "").trim();
    if (!raw) return { store, entries: [] };
    if (raw.toLowerCase() === "all") return { store, entries: activeEntries };

    const byOrder = new Map(activeEntries.map((entry) => [Number(entry.order_index), entry]));
    const byId = new Map(activeEntries.map((entry) => [entry.entry_id, entry]));
    const idRange = raw.match(/^([a-z]+-[a-z0-9_-]+)\s*-\s*([a-z]+-[a-z0-9_-]+)$/i);
    if (idRange) {
      const start = activeEntries.findIndex((entry) => entry.entry_id === idRange[1]);
      const end = activeEntries.findIndex((entry) => entry.entry_id === idRange[2]);
      if (start >= 0 && end >= 0) return { store, entries: activeEntries.slice(Math.min(start, end), Math.max(start, end) + 1) };
    }

    const selected = [];
    for (const part of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
      const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Math.min(Number(range[1]), Number(range[2]));
        const end = Math.max(Number(range[1]), Number(range[2]));
        for (let index = start; index <= end; index += 1) {
          const entry = byOrder.get(index);
          if (entry) selected.push(entry);
        }
      } else if (/^\d+$/.test(part)) {
        const entry = byOrder.get(Number(part));
        if (entry) selected.push(entry);
      } else {
        const entry = byId.get(part);
        if (entry) selected.push(entry);
      }
    }
    const seen = new Set();
    return { store, entries: selected.filter((entry) => !seen.has(entry.entry_id) && seen.add(entry.entry_id)) };
  }

  function appendDateMemory(entry) {
    const json = readJson(dateMemoryPath, { version: 1, next_entry_id: 1, needs_compaction: false, entries: [] });
    const entries = Array.isArray(json.entries) ? json.entries : [];
    entries.push({
      id: entry.entry_id,
      order_index: entry.order_index,
      role: entry.role,
      title: entry.title,
      text: entry.text,
      date: entry.date_key,
      created_at: entry.created_at,
      chars: entry.chars,
      lines: entry.lines,
      status: entry.status,
      compact_of: entry.compact_of
    });
    const totalChars = entries.reduce((sum, item) => sum + Number(item.chars ?? 0), 0);
    writeJson(dateMemoryPath, {
      version: 1,
      next_entry_id: Number(json.next_entry_id ?? 1) + 1,
      needs_compaction: totalChars >= dateMemoryCompactChars,
      entries
    });
  }

  function recordContextEntry(input) {
    ensureMemory();
    const createdAt = new Date().toISOString();
    const text = String(input.text ?? "");
    const entry = {
      entry_id: input.entryId ?? makeEntryId("ent"),
      order_index: input.orderIndex ?? nextOrderIndex(),
      role: input.role ?? "system",
      kind: input.kind ?? "chat",
      title: input.title ?? "记录",
      text,
      date_key: dateKey(),
      created_at: createdAt,
      chars: text.length,
      lines: countLines(text),
      status: input.status ?? "active",
      compact_of: input.compactOf ? safeJson(input.compactOf) : null,
      tool_ref: input.toolRef ?? null
    };
    const params = [
      entry.entry_id, entry.order_index, entry.role, entry.kind, entry.title, entry.text, entry.date_key,
      entry.created_at, entry.chars, entry.lines, entry.status, entry.compact_of, entry.tool_ref
    ];
    const insertSql = `
      INSERT INTO __TABLE__(entry_id, order_index, role, kind, title, text, date_key, created_at, chars, lines, status, compact_of, tool_ref)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET
        order_index = excluded.order_index,
        role = excluded.role,
        kind = excluded.kind,
        title = excluded.title,
        text = excluded.text,
        date_key = excluded.date_key,
        created_at = excluded.created_at,
        chars = excluded.chars,
        lines = excluded.lines,
        status = excluded.status,
        compact_of = excluded.compact_of,
        tool_ref = excluded.tool_ref
    `;
    db.prepare(insertSql.replace("__TABLE__", "context_entries")).run(...params);
    db.prepare(insertSql.replace("__TABLE__", "memory_entries")).run(...params);
    appendDateMemory(entry);
    return entry;
  }

  function setEntryStatus(entryIds, status) {
    ensureMemory();
    const update = db.prepare("UPDATE context_entries SET status = ? WHERE entry_id = ?");
    const updateMemory = db.prepare("UPDATE memory_entries SET status = ? WHERE entry_id = ?");
    for (const entryId of entryIds) {
      update.run(status, entryId);
      updateMemory.run(status, entryId);
    }
  }

  function replaceContextEntry(entryId, patch) {
    ensureMemory();
    const row = db.prepare("SELECT * FROM context_entries WHERE entry_id = ?").get(entryId);
    if (!row) return null;
    const next = {
      ...row,
      title: patch.title ?? row.title,
      text: patch.text ?? row.text,
      kind: patch.kind ?? row.kind,
      role: patch.role ?? row.role,
      chars: String(patch.text ?? row.text).length,
      lines: countLines(patch.text ?? row.text),
      compact_of: patch.compactOf ? safeJson(patch.compactOf) : row.compact_of,
      status: patch.status ?? "active"
    };
    const params = [next.role, next.kind, next.title, next.text, next.chars, next.lines, next.status, next.compact_of, entryId];
    const sql = "UPDATE __TABLE__ SET role = ?, kind = ?, title = ?, text = ?, chars = ?, lines = ?, status = ?, compact_of = ? WHERE entry_id = ?";
    db.prepare(sql.replace("__TABLE__", "context_entries")).run(...params);
    db.prepare(sql.replace("__TABLE__", "memory_entries")).run(...params);
    return next;
  }

  function getActiveEntries() {
    ensureMemory();
    return db.prepare("SELECT * FROM context_entries WHERE status = 'active' ORDER BY order_index ASC").all();
  }

  function resolveEntrySelector(selector) {
    const entries = getActiveEntries();
    const raw = String(selector ?? "").trim();
    if (!raw) return [];
    if (raw.toLowerCase() === "all") return entries;
    const byOrder = new Map(entries.map((entry) => [Number(entry.order_index), entry]));
    const byId = new Map(entries.map((entry) => [entry.entry_id, entry]));
    const idRange = raw.match(/^(ent-[a-z0-9_-]+)\s*-\s*(ent-[a-z0-9_-]+)$/i);
    if (idRange) {
      const start = entries.findIndex((entry) => entry.entry_id === idRange[1]);
      const end = entries.findIndex((entry) => entry.entry_id === idRange[2]);
      if (start >= 0 && end >= 0) return entries.slice(Math.min(start, end), Math.max(start, end) + 1);
    }
    const selected = [];
    for (const part of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
      const normalized = part.replace(/^id/i, "").replace(/^#/, "");
      const range = normalized.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Math.min(Number(range[1]), Number(range[2]));
        const end = Math.max(Number(range[1]), Number(range[2]));
        for (let index = start; index <= end; index += 1) {
          const entry = byOrder.get(index);
          if (entry) selected.push(entry);
        }
      } else if (/^\d+$/.test(normalized)) {
        const entry = byOrder.get(Number(normalized));
        if (entry) selected.push(entry);
      } else {
        const entry = byId.get(part);
        if (entry) selected.push(entry);
      }
    }
    const seen = new Set();
    return selected.filter((entry) => !seen.has(entry.entry_id) && seen.add(entry.entry_id));
  }

  function storeToolResult(toolName, callInput, resultText, options = {}) {
    ensureMemory();
    const fullText = String(resultText ?? "");
    const entry = recordContextEntry({
      role: "tool",
      kind: "tool_result",
      title: toolName,
      text: summarizeText(fullText, 1800),
      toolRef: toolName
    });
    const visibleOutput = summarizeText(fullText, Math.min(visibleToolChars, 1800));
    const externalized = fullText.length > visibleToolChars;
    const summary = options.summary || toolSummary(toolName, callInput, fullText, externalized);
    db.prepare(
      `INSERT INTO tool_memory(entry_id, tool_name, call_json, result_text, visible_output, summary, created_at, chars, lines, externalized)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.entry_id, toolName, safeJson(callInput), fullText, visibleOutput, summary, entry.created_at,
      fullText.length, countLines(fullText), externalized ? 1 : 0
    );
    return {
      ok: options.ok !== false,
      entryId: entry.entry_id,
      tool: toolName,
      summary,
      visibleOutput,
      externalized,
      error: options.error,
      errorCategory: options.errorCategory,
      retriable: options.retriable,
      advice: options.advice,
      ...(typeof options.modelOutput === "string" || Array.isArray(options.modelOutput) ? { modelOutput: options.modelOutput } : {}),
      ...(options.batchSafety && typeof options.batchSafety === "object" && !Array.isArray(options.batchSafety)
        ? { batchSafety: options.batchSafety }
        : {}),
      memoryRef: {
        type: "toolmemory",
        entryId: entry.entry_id,
        chars: fullText.length,
        lines: countLines(fullText),
        hint: "使用 memory(operation=check/read, entryId, keyword, lineStart, lineEnd) 精确读取"
      }
    };
  }

  function requiredFastMemoryScope(input = {}) {
    const rawProjectId = String(input.projectId || "").trim();
    const rawConversationId = String(input.conversationId || "").trim();
    if (rawProjectId.includes("\0") || rawConversationId.includes("\0") || rawProjectId.length > 160 || rawConversationId.length > 160) {
      return { ok: false, error: "projectId 或 conversationId 无效。" };
    }
    const scope = externalScopeFromInput(input);
    if (!scope.projectId || !scope.conversationId) return { ok: false, error: "绘画经验配置需要 projectId 和 conversationId。" };
    return { ok: true, ...scope };
  }

  function exactScopedFastMemoryEntries(store, scope) {
    return store.entries.filter((entry) =>
      entry.status === "active" &&
      externalScopeValue(entry.projectId) === scope.projectId &&
      externalScopeValue(entry.conversationId) === scope.conversationId
    );
  }

  function scopedFastMemoryText(store, scope) {
    return exactScopedFastMemoryEntries(store, scope)
      .sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0))
      .map((entry) => sanitizeFastMemoryText(entry.text))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function scopedFastMemoryUpdatedAt(store, scope) {
    return exactScopedFastMemoryEntries(store, scope)
      .map((entry) => String(entry.updated_at || entry.created_at || "").trim())
      .filter(Boolean)
      .sort()
      .at(-1) || "";
  }

  function getMainPrompt() {
    const store = readPromptTextStore();
    return {
      ok: true,
      text: store.mainPrompt,
      ...promptStoreStatus(store),
      defaultText: defaultMainAgentPrompt,
      maxChars: mainAgentPromptMaxChars,
      updatedAt: store.updatedAt
    };
  }

  function saveMainPrompt(input = {}) {
    const validated = validateEditableText(input?.text, mainAgentPromptMaxChars, "Main Agent Prompt");
    if (!validated.ok) return { ok: false, error: validated.error, maxChars: mainAgentPromptMaxChars };
    const current = readPromptTextStore();
    const currentStatus = promptStoreStatus(current);
    const nextIsDefault = validated.text === defaultMainAgentPrompt;
    const store = writePromptTextStore({
      ...current,
      mainPrompt: validated.text,
      baseDefaultPromptRevision: nextIsDefault ? defaultMainAgentPromptRevision : currentStatus.baseDefaultPromptRevision,
      baseDefaultPromptHash: nextIsDefault ? defaultMainAgentPromptHash : currentStatus.baseDefaultPromptHash,
      updatedAt: new Date().toISOString()
    });
    return {
      ok: true,
      text: store.mainPrompt,
      ...promptStoreStatus(store),
      defaultText: defaultMainAgentPrompt,
      maxChars: mainAgentPromptMaxChars,
      updatedAt: store.updatedAt
    };
  }

  function resetMainPrompt() {
    const current = readPromptTextStore();
    const store = writePromptTextStore({
      ...current,
      mainPrompt: defaultMainAgentPrompt,
      baseDefaultPromptRevision: defaultMainAgentPromptRevision,
      baseDefaultPromptHash: defaultMainAgentPromptHash,
      updatedAt: new Date().toISOString()
    });
    return {
      ok: true,
      text: store.mainPrompt,
      ...promptStoreStatus(store),
      defaultText: defaultMainAgentPrompt,
      maxChars: mainAgentPromptMaxChars,
      updatedAt: store.updatedAt
    };
  }

  function getFastMemory(input = {}) {
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) return { ok: false, error: scope.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };
    const store = readExternalStore("fastmemory");
    const text = scopedFastMemoryText(store, scope);
    return {
      ok: true,
      text,
      isEmpty: !text,
      isOversized: text.length > scopedFastMemoryMaxChars,
      maxChars: scopedFastMemoryMaxChars,
      contextMaxChars: fastMemoryPromptMaxChars,
      updatedAt: scopedFastMemoryUpdatedAt(store, scope)
    };
  }

  function saveFastMemory(input = {}) {
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) return { ok: false, error: scope.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };
    const validated = validateEditableText(input?.text, scopedFastMemoryMaxChars, "绘画经验", sanitizeFastMemoryText);
    if (!validated.ok) return { ok: false, error: validated.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };
    const store = readExternalStore("fastmemory");
    const currentText = scopedFastMemoryText(store, scope);
    const currentUpdatedAt = scopedFastMemoryUpdatedAt(store, scope);
    if (Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt") && String(input.expectedUpdatedAt || "") !== currentUpdatedAt) {
      return {
        ok: false,
        conflict: true,
        error: "Agent 记忆在编辑期间已更新，请先合并最新内容。",
        text: currentText,
        isEmpty: !currentText,
        maxChars: scopedFastMemoryMaxChars,
        updatedAt: currentUpdatedAt
      };
    }
    store.entries = store.entries.filter((entry) => !(
      externalScopeValue(entry.projectId) === scope.projectId && externalScopeValue(entry.conversationId) === scope.conversationId
    ));
    const now = new Date().toISOString();
    store.entries.push({
      entry_id: makeEntryId("fmem"),
      order_index: nextExternalOrder(store),
      section: "experience",
      title: "绘画经验",
      text: validated.text,
      status: "active",
      keywords: [],
      created_at: now,
      updated_at: now,
      compact_of: [],
      projectId: scope.projectId,
      conversationId: scope.conversationId
    });
    writeExternalStore("fastmemory", store);
    return { ok: true, text: validated.text, isEmpty: false, maxChars: scopedFastMemoryMaxChars, updatedAt: now };
  }

  function resetFastMemory(input = {}) {
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) return { ok: false, error: scope.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };
    const store = readExternalStore("fastmemory");
    const currentText = scopedFastMemoryText(store, scope);
    const currentUpdatedAt = scopedFastMemoryUpdatedAt(store, scope);
    if (Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt") && String(input.expectedUpdatedAt || "") !== currentUpdatedAt) {
      return {
        ok: false,
        conflict: true,
        error: "Agent 记忆在编辑期间已更新，请先合并最新内容。",
        text: currentText,
        isEmpty: !currentText,
        maxChars: scopedFastMemoryMaxChars,
        updatedAt: currentUpdatedAt
      };
    }
    const before = store.entries.length;
    store.entries = store.entries.filter((entry) => !(
      externalScopeValue(entry.projectId) === scope.projectId && externalScopeValue(entry.conversationId) === scope.conversationId
    ));
    const cleared = before - store.entries.length;
    if (cleared > 0) writeExternalStore("fastmemory", store);
    return { ok: true, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars, cleared, updatedAt: "" };
  }

  function clearConversationState(input = {}) {
    ensureMemory();
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) return { ok: false, error: "清理会话需要 projectId 和 conversationId。", clearedFastMemory: 0, clearedSummary: false };
    const { projectId, conversationId } = scope;
    const store = readExternalStore("fastmemory");
    const before = store.entries.length;
    store.entries = store.entries.filter((entry) => !(
      externalScopeValue(entry.projectId) === projectId && externalScopeValue(entry.conversationId) === conversationId
    ));
    const clearedFastMemory = before - store.entries.length;
    if (clearedFastMemory > 0) writeExternalStore("fastmemory", store);
    const summaryResult = db.prepare("DELETE FROM runtime_meta WHERE key = ?").run(conversationSummaryKey({ projectId, conversationId }));
    const protocolResult = db.prepare("DELETE FROM runtime_meta WHERE key = ?").run(conversationProtocolKey({ projectId, conversationId }));
    return {
      ok: true,
      projectId,
      conversationId,
      clearedFastMemory,
      clearedSummary: Number(summaryResult?.changes || 0) > 0,
      clearedProtocol: Number(protocolResult?.changes || 0) > 0,
      summary: "当前聊天上下文和绘画经验已清理。"
    };
  }

  function addExternalEntry(target, input = {}) {
    const store = readExternalStore(target);
    const now = new Date().toISOString();
    const section = String(input.section || (target === "memorycontext" ? "private" : "surface"));
    const prefix = target === "memorycontext" ? "mctx" : "fmem";
    const scope = externalScopeFromInput(input);
    const entry = {
      entry_id: makeEntryId(prefix),
      order_index: nextExternalOrder(store),
      section,
      title: String(input.title || (target === "memorycontext" ? "Memory Context" : "FastMemory")),
      text: String(input.text || input.summary || ""),
      status: "active",
      keywords: splitKeywords(input.keywords),
      created_at: now,
      updated_at: now,
      compact_of: [],
      ...(target === "fastmemory" && scope.projectId ? { projectId: scope.projectId } : {}),
      ...(target === "fastmemory" && scope.conversationId ? { conversationId: scope.conversationId } : {})
    };
    if (!entry.text.trim()) return { ok: false, target, summary: "缺少 text，未写入。" };
    store.entries.push(entry);
    writeExternalStore(target, store);
    return {
      ok: true,
      target,
      action: "add",
      entryId: entry.entry_id,
      section: entry.section,
      summary: `${target} 已写入 ${entry.entry_id}。`
    };
  }

  function compactExternalEntries(target, input = {}) {
    const section = String(input.section || "");
    const selector = input.selector ?? (input.scope === "all" ? "all" : "");
    const { store, entries } = resolveExternalSelector(target, selector, section, input);
    const scope = externalScopeFromInput(input);
    if (!entries.length) return { ok: false, target, selector, summary: `没有找到可 compact 的 ${target} entries。`, selectedEntryIds: [] };
    const now = new Date().toISOString();
    const sourceText = entries.map((entry) => `[${entry.entry_id}] ${entry.section}/${entry.title}\n${entry.text}`).join("\n\n");
    const summaryText = String(input.summary || input.text || "").trim() || [
      `### ${target} compact`,
      "",
      `selector: ${selector}`,
      `entries: ${entries.map((entry) => entry.entry_id).join(", ")}`,
      "",
      summarizeText(sourceText, 3600),
      "",
      `instruction: ${input.instruction || "保留稳定偏好、关键规则和可执行线索。"}`
    ].join("\n");

    if (entries.length === 1) {
      const selected = entries[0];
      store.entries = store.entries.map((entry) =>
        entry.entry_id === selected.entry_id
          ? {
              ...entry,
              title: String(input.title || `compact ${selected.title}`),
              text: summaryText,
              keywords: splitKeywords(input.keywords).length ? splitKeywords(input.keywords) : entry.keywords,
              updated_at: now,
              compact_of: Array.from(new Set([...(entry.compact_of || []), selected.entry_id]))
            }
          : entry
      );
      writeExternalStore(target, store);
      return {
        ok: true,
        target,
        action: "compact",
        entryId: selected.entry_id,
        selectedEntryIds: [selected.entry_id],
        replaced: true,
        summary: summarizeText(summaryText, 1600)
      };
    }

    const selectedIds = new Set(entries.map((entry) => entry.entry_id));
    const newEntry = {
      entry_id: makeEntryId(target === "memorycontext" ? "mctx" : "fmem"),
      order_index: nextExternalOrder(store),
      section: String(input.section || entries[0]?.section || (target === "memorycontext" ? "private" : "surface")),
      title: String(input.title || `compact ${selector}`),
      text: summaryText,
      status: "active",
      keywords: splitKeywords(input.keywords),
      created_at: now,
      updated_at: now,
      compact_of: entries.map((entry) => entry.entry_id),
      ...(target === "fastmemory" && (scope.projectId || entries[0]?.projectId) ? { projectId: scope.projectId || entries[0]?.projectId } : {}),
      ...(target === "fastmemory" && (scope.conversationId || entries[0]?.conversationId) ? { conversationId: scope.conversationId || entries[0]?.conversationId } : {})
    };
    store.entries = store.entries.map((entry) => selectedIds.has(entry.entry_id) ? { ...entry, status: "compacted", updated_at: now } : entry);
    store.entries.push(newEntry);
    writeExternalStore(target, store);
    return {
      ok: true,
      target,
      action: "compact",
      entryId: newEntry.entry_id,
      selectedEntryIds: entries.map((entry) => entry.entry_id),
      replaced: false,
      summary: summarizeText(summaryText, 1600)
    };
  }

  function replaceExternalEntry(target, input = {}) {
    const section = String(input.section || "");
    const selector = input.selector ?? "";
    const { store, entries } = resolveExternalSelector(target, selector, section, input);
    if (!entries.length) return { ok: false, target, action: "replace", selector, summary: `没有找到可替换的 ${target} entry。`, selectedEntryIds: [] };
    if (entries.length !== 1) {
      return {
        ok: false,
        target,
        action: "replace",
        selector,
        selectedEntryIds: entries.map((entry) => entry.entry_id),
        summary: "replace 需要精确选择一个 entry；多个 entry 请使用 compact。"
      };
    }
    const text = String(input.text || input.summary || "").trim();
    if (!text) return { ok: false, target, action: "replace", selector, entryId: entries[0].entry_id, summary: "缺少 text，未替换。" };
    const selected = entries[0];
    const now = new Date().toISOString();
    store.entries = store.entries.map((entry) =>
      entry.entry_id === selected.entry_id
        ? {
            ...entry,
            section: String(input.section || entry.section),
            title: String(input.title || entry.title),
            text,
            keywords: splitKeywords(input.keywords).length ? splitKeywords(input.keywords) : entry.keywords,
            updated_at: now
          }
        : entry
    );
    writeExternalStore(target, store);
    return {
      ok: true,
      target,
      action: "replace",
      entryId: selected.entry_id,
      selectedEntryIds: [selected.entry_id],
      summary: `${target} 已替换 ${selected.entry_id}。`
    };
  }

  function readExternalEntries(target, input = {}) {
    const section = String(input.section || "");
    const selector = input.selector ?? (input.scope === "all" ? "all" : "");
    const { entries } = resolveExternalSelector(target, selector, section, input);
    return {
      ok: entries.length > 0,
      target,
      action: "read",
      selector,
      selectedEntryIds: entries.map((entry) => entry.entry_id),
      entries: entries.map((entry) => ({
        entry_id: entry.entry_id,
        section: entry.section,
        title: entry.title,
        status: entry.status,
        text: summarizeText(entry.text, 1600),
        keywords: entry.keywords
      })),
      summary: entries.length ? `${target} 已读取 ${entries.length} 条 entry。` : `没有找到可读取的 ${target} entry。`
    };
  }

  function compact(input = {}) {
    const selector = input.selector ?? "all";
    const entries = resolveEntrySelector(selector);
    if (!entries.length) return { ok: false, selector, summary: "没有找到可 compact 的 active entries。", selectedEntryIds: [] };
    const text = entries.map((entry) => `[${entry.entry_id}] ${entry.role}/${entry.kind}/${entry.title}\n${entry.text}`).join("\n\n");
    const summary = String(input.summary || input.text || "").trim() ||
      `### Context Compact\n\nselector: ${selector}\nentries: ${entries.map((entry) => entry.entry_id).join(", ")}\n\n${summarizeText(text, 3600)}\n\ninstruction: ${input.instruction ?? "保留关键任务、决策、工具引用和用户偏好。"}`;
    if (entries.length === 1) {
      const replaced = replaceContextEntry(entries[0].entry_id, {
        title: input.title || `compact ${entries[0].title}`,
        text: summary,
        kind: "compact",
        compactOf: [entries[0].entry_id]
      });
      return {
        ok: true,
        selector,
        entryId: replaced?.entry_id || entries[0].entry_id,
        selectedEntryIds: [entries[0].entry_id],
        replaced: true,
        summary: summarizeText(summary, 1600)
      };
    }
    setEntryStatus(entries.map((entry) => entry.entry_id), "compacted");
    const compactEntry = recordContextEntry({
      role: "system",
      kind: "compact",
      title: `compact ${selector}`,
      text: summary,
      compactOf: entries.map((entry) => entry.entry_id)
    });
    return {
      ok: true,
      selector,
      entryId: compactEntry.entry_id,
      selectedEntryIds: entries.map((entry) => entry.entry_id),
      summary: summarizeText(summary, 1600)
    };
  }

  function contextManage(input = {}) {
    const requestedAction = String(input.action || "");
    const requestedTarget = String(input.target || "context").trim().toLowerCase();
    if (requestedTarget === "prompt") {
      return { ok: false, target: "prompt", action: requestedAction || "read", summary: "Agent Prompt 只能通过专用纯文本配置接口读取或编辑。" };
    }
    if (requestedAction === "add_experience") {
      return addExternalEntry("fastmemory", {
        ...input,
        section: "experience",
        title: input.title || `经验 ${input.rating || "note"}`,
        text: [
          `rating: ${input.rating || "note"}`,
          `source: ${(input.sourceEntryIds || []).join(", ")}`,
          "",
          String(input.text || input.summary || "")
        ].join("\n"),
        keywords: ["experience", input.rating || "note", ...splitKeywords(input.keywords)]
      });
    }
    const target = ["fastmemory", "memorycontext"].includes(requestedTarget) ? requestedTarget : "context";
    const action = ["add", "write", "replace", "read", "compact"].includes(requestedAction)
      ? requestedAction
      : input.text && !input.selector ? "add" : "compact";
    if (target === "fastmemory" || target === "memorycontext") {
      if (action === "add" || action === "write") return addExternalEntry(target, input);
      if (action === "replace") return replaceExternalEntry(target, input);
      if (action === "read") return readExternalEntries(target, input);
      return compactExternalEntries(target, input);
    }
    if (action === "add" || action === "write") {
      const entry = recordContextEntry({
        role: "system",
        kind: String(input.kind || "context_note"),
        title: input.title || "外置上下文补充",
        text: input.text || input.summary || ""
      });
      return { ok: true, target, action: "add", entryId: entry.entry_id, summary: `Context 已写入 ${entry.entry_id}。` };
    }
    if (action === "replace") {
      const entries = resolveEntrySelector(input.selector ?? "");
      if (!entries.length) return { ok: false, target, action: "replace", selector: input.selector ?? "", summary: "没有找到可替换的 Context entry。", selectedEntryIds: [] };
      if (entries.length !== 1) {
        return {
          ok: false,
          target,
          action: "replace",
          selector: input.selector ?? "",
          selectedEntryIds: entries.map((entry) => entry.entry_id),
          summary: "replace 需要精确选择一个 entry；多个 entry 请使用 compact。"
        };
      }
      const text = String(input.text || input.summary || "").trim();
      if (!text) return { ok: false, target, action: "replace", entryId: entries[0].entry_id, summary: "缺少 text，未替换。" };
      const replaced = replaceContextEntry(entries[0].entry_id, {
        title: input.title || entries[0].title,
        text,
        kind: input.kind || entries[0].kind
      });
      return {
        ok: true,
        target,
        action: "replace",
        entryId: replaced?.entry_id || entries[0].entry_id,
        selectedEntryIds: [entries[0].entry_id],
        summary: `Context 已替换 ${entries[0].entry_id}。`
      };
    }
    if (action === "read") {
      const entries = resolveEntrySelector(input.selector ?? "");
      return {
        ok: entries.length > 0,
        target,
        action: "read",
        selector: input.selector ?? "",
        selectedEntryIds: entries.map((entry) => entry.entry_id),
        entries: entries.map((entry) => ({
          entry_id: entry.entry_id,
          title: entry.title,
          kind: entry.kind,
          text: summarizeText(entry.text, 1600)
        })),
        summary: entries.length ? `Context 已读取 ${entries.length} 条 entry。` : "没有找到可读取的 Context entry。"
      };
    }
    return compact(input);
  }

  function experienceManage(input = {}) {
    const action = ["add", "write", "replace", "read", "compact"].includes(String(input.action || "")) ? String(input.action || "") : "read";
    const baseInput = {
      ...input,
      target: "fastmemory",
      section: "experience",
      keywords: Array.from(new Set(["experience", "painting", ...splitKeywords(input.keywords)]))
    };
    if (action === "add" || action === "write") {
      const text = String(input.text || input.summary || "").trim();
      if (!text) return { ok: false, tool: "experience", action: "add", summary: "缺少绘画经验正文，未写入。" };
      const result = addExternalEntry("fastmemory", {
        ...baseInput,
        title: input.title || `绘画经验 ${input.rating || "note"}`,
        text: [
          `rating: ${input.rating || "note"}`,
          input.sourceEntryIds?.length ? `source: ${input.sourceEntryIds.join(", ")}` : "",
          "",
          text
        ].filter(Boolean).join("\n")
      });
      return result.ok
        ? { ok: true, tool: "experience", action: "add", summary: "绘画经验已记录。" }
        : { ok: false, tool: "experience", action: "add", summary: result.summary || "绘画经验记录失败。" };
    }
    if (action === "replace") {
      const result = saveFastMemory(baseInput);
      return result.ok
        ? { ok: true, tool: "experience", action: "replace", summary: "绘画经验已更新。" }
        : { ok: false, tool: "experience", action: "replace", summary: result.error || "绘画经验更新失败。" };
    }
    if (action === "compact") {
      const result = compactExternalEntries("fastmemory", { ...baseInput, selector: "all" });
      return result.ok
        ? { ok: true, tool: "experience", action: "compact", summary: "绘画经验已整理。" }
        : { ok: false, tool: "experience", action: "compact", summary: "没有可整理的绘画经验。" };
    }
    const result = getFastMemory(baseInput);
    return result.ok
      ? { ok: true, tool: "experience", action: "read", text: result.text, isEmpty: result.isEmpty, summary: result.isEmpty ? "当前没有绘画经验。" : "绘画经验已读取。" }
      : { ok: false, tool: "experience", action: "read", text: "", isEmpty: true, summary: result.error || "绘画经验读取失败。" };
  }

  function memoryAdd(input = {}) {
    ensureMemory();
    const target = String(input.target || "datememory").toLowerCase();
    if (target !== "datememory") return { ok: false, target, summary: "memory operation=add 目前只允许 target=datememory。" };
    const rawEntries = Array.isArray(input.entries) ? input.entries : input.entry ? [input.entry] : [];
    const written = [];
    for (const item of rawEntries) {
      const diary = item && typeof item === "object" ? item : {};
      const date = String(diary.date || diary.dateKey || dateKey()).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const content = String(diary.content || diary.text || "").trim();
      if (!content) continue;
      const title = String(diary.title || `${date} 日记`).trim();
      const keywords = splitKeywords(diary.keywords);
      const sourceEntryIds = Array.isArray(diary.sourceEntryIds) ? diary.sourceEntryIds.map(String).filter(Boolean) : [];
      const previous = db.prepare("SELECT * FROM date_memory WHERE date_key = ?").get(date);
      const block = [
        `## ${title}`,
        keywords.length ? `keywords: ${keywords.join(", ")}` : "",
        sourceEntryIds.length ? `source: ${sourceEntryIds.join(", ")}` : "",
        "",
        content
      ].filter(Boolean).join("\n");
      const summary = previous?.summary ? `${previous.summary}\n\n---\n${block}` : block;
      const nextKeywords = Array.from(new Set([...(previous?.keywords ? splitKeywords(previous.keywords) : []), ...keywords]));
      const nextEntryIds = Array.from(new Set([...(previous?.entry_ids ? splitKeywords(previous.entry_ids) : []), ...sourceEntryIds]));
      db.prepare(
        `INSERT INTO date_memory(date_key, summary, chars, status, updated_at, keywords, entry_ids)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date_key) DO UPDATE SET
           summary = excluded.summary,
           chars = excluded.chars,
           status = excluded.status,
           updated_at = excluded.updated_at,
           keywords = excluded.keywords,
           entry_ids = excluded.entry_ids`
      ).run(date, summary, summary.length, "active", new Date().toISOString(), nextKeywords.join(","), nextEntryIds.join(","));
      written.push({ date, title, chars: content.length, keywords: nextKeywords, sourceEntryIds });
    }
    if (input.clearContext) writeJson(dateMemoryPath, { version: 1, next_entry_id: 1, needs_compaction: false, entries: [] });
    return {
      ok: written.length > 0,
      target,
      written,
      clearedContext: Boolean(input.clearContext),
      summary: written.length ? `datememory 已写入 ${written.length} 篇日记。` : "没有可写入的 datememory 日记。"
    };
  }

  function memoryCheck(input = {}) {
    ensureMemory();
    const entryId = input.entryId ? String(input.entryId) : "";
    const keywords = splitKeywords(input.keywords ?? input.keyword);
    const keyword = keywords.join(" ");
    const scope = String(input.scope || "").toLowerCase();
    if (entryId && (!scope || scope === "tool" || scope === "toolmemory")) {
      const tool = db.prepare("SELECT * FROM tool_memory WHERE entry_id = ?").get(entryId);
      if (tool) {
        const lines = String(tool.result_text ?? "").split(/\r?\n/);
        const matches = keywords.length
          ? lines.map((line, index) => ({ line, lineNumber: index + 1 }))
              .filter((item) => keywords.some((word) => item.line.toLowerCase().includes(word.toLowerCase())))
              .slice(0, 20)
          : [];
        return { ok: true, scope: "tool", entryId, summary: tool.summary, chars: tool.chars, lines: tool.lines, matches };
      }
      if (scope === "tool" || scope === "toolmemory") return { ok: false, scope: "tool", entryId, summary: "未找到 toolmemory entry。" };
    }
    if (entryId) {
      const entry = db.prepare("SELECT * FROM memory_entries WHERE entry_id = ?").get(entryId);
      return entry ? { ok: true, scope: "meta", entry } : { ok: false, entryId, summary: "未找到 entry。" };
    }
    if (keywords.length && (!scope || scope === "date" || scope === "datememory")) {
      const rows = db.prepare("SELECT * FROM date_memory ORDER BY date_key DESC LIMIT 400").all();
      const hits = rows.map((row) => {
        const haystack = `${row.date_key}\n${row.keywords || ""}\n${row.summary || ""}`.toLowerCase();
        const matched = keywords.filter((word) => haystack.includes(word.toLowerCase()));
        const score = matched.reduce((sum, word) => sum + (String(row.keywords || "").toLowerCase().includes(word.toLowerCase()) ? 3 : 1), 0);
        return { row, matched, score };
      }).filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || String(b.row.date_key).localeCompare(String(a.row.date_key)));
      return {
        ok: true,
        scope: "date",
        query: keywords,
        best: hits[0]
          ? {
              date: hits[0].row.date_key,
              score: hits[0].score,
              matchedKeywords: hits[0].matched,
              keywords: splitKeywords(hits[0].row.keywords),
              entryIds: splitKeywords(hits[0].row.entry_ids),
              summary: summarizeText(hits[0].row.summary, 5000)
            }
          : null,
        hits: hits.slice(1, 12).map((item) => ({
          date: item.row.date_key,
          score: item.score,
          matchedKeywords: item.matched,
          keywords: splitKeywords(item.row.keywords)
        }))
      };
    }
    const targetDate = input.date ? String(input.date).slice(0, 10) : dateKey();
    const dateRow = db.prepare("SELECT * FROM date_memory WHERE date_key = ?").get(targetDate);
    if (dateRow && (!scope || scope === "date" || scope === "datememory")) {
      return {
        ok: true,
        scope: "date",
        date: targetDate,
        summary: summarizeText(dateRow.summary, 5000),
        keywords: splitKeywords(dateRow.keywords),
        entryIds: splitKeywords(dateRow.entry_ids),
        chars: dateRow.chars,
        status: dateRow.status
      };
    }
    const rows = keyword
      ? db.prepare("SELECT * FROM memory_entries WHERE text LIKE ? OR title LIKE ? ORDER BY order_index DESC LIMIT 80")
          .all(`%${keyword}%`, `%${keyword}%`)
      : db.prepare("SELECT * FROM memory_entries WHERE date_key = ? ORDER BY order_index ASC LIMIT 80").all(targetDate);
    return {
      ok: true,
      scope: "meta",
      date: targetDate,
      entries: rows.map((row) => ({
        entryId: row.entry_id,
        orderIndex: row.order_index,
        role: row.role,
        title: row.title,
        status: row.status,
        preview: summarizeText(row.text, 240)
      }))
    };
  }

  function memoryRead(input = {}) {
    ensureMemory();
    const scope = String(input.scope || "").toLowerCase();
    const date = input.date ? String(input.date).slice(0, 10) : "";
    const entryId = String(input.entryId ?? "");
    if ((scope === "date" || scope === "datememory" || (!scope && date)) && date) {
      const row = db.prepare("SELECT * FROM date_memory WHERE date_key = ?").get(date);
      return row
        ? { ok: true, scope: "date", date, keywords: splitKeywords(row.keywords), entryIds: splitKeywords(row.entry_ids), text: row.summary }
        : { ok: false, scope: "date", date, summary: "未找到 datememory 日记。" };
    }
    if (!entryId) return { ok: false, summary: "需要 entryId 或 date。" };
    const tool = db.prepare("SELECT * FROM tool_memory WHERE entry_id = ?").get(entryId);
    if (!tool && (scope === "tool" || scope === "toolmemory")) return { ok: false, entryId, summary: "未找到 toolmemory。" };
    if (!tool) {
      const entry = db.prepare("SELECT * FROM memory_entries WHERE entry_id = ?").get(entryId);
      return entry ? { ok: true, scope: "meta", entryId, text: entry.text, entry } : { ok: false, entryId, summary: "未找到 memory entry。" };
    }
    const lines = String(tool.result_text ?? "").split(/\r?\n/);
    const start = Math.max(1, Number(input.lineStart ?? 1));
    const end = Math.min(lines.length, Number(input.lineEnd ?? Math.min(start + 80, lines.length)));
    return { ok: true, scope: "tool", entryId, lineStart: start, lineEnd: end, totalLines: lines.length, text: lines.slice(start - 1, end).join("\n") };
  }

  function externalPromptFor(section = "main") {
    const store = readPromptTextStore();
    return section === "memory"
      ? String(store.memoryPrompt || defaultMemoryAgentPrompt)
      : String(store.mainPrompt || defaultMainAgentPrompt);
  }

  function fastMemoryForPrompt(scope = {}, limits = {}) {
    const exactScope = requiredFastMemoryScope(scope);
    if (!exactScope.ok) return "暂无绘画经验。";
    const store = readExternalStore("fastmemory");
    const entries = exactScopedFastMemoryEntries(store, exactScope);
    if (!entries.length) return "暂无绘画经验。";
    return selectFastMemoryPromptContext(entries, scope, limits).text || "暂无绘画经验。";
  }

  function memoryContextForPrompt() {
    const store = readExternalStore("memorycontext");
    const entries = store.entries.filter((entry) => entry.status === "active");
    if (!entries.length) return "暂无后台 Memory Context。";
    return entries
      .slice(-24)
      .map((entry) => `[${entry.entry_id}] ${entry.section}/${entry.title}${entry.keywords?.length ? ` keywords=${entry.keywords.join(",")}` : ""}\n${summarizeText(entry.text, 700)}`)
      .join("\n\n");
  }

  function recentContextForPrompt() {
    try {
      return getActiveEntries()
        .slice(-16)
        .map((row) => `[${row.entry_id}] #${row.order_index} ${row.role}/${row.kind}/${row.title}\n${summarizeText(row.text, 700)}`)
        .join("\n\n");
    } catch {
      return "";
    }
  }

  function compactStateForPayload(payload = {}) {
    const state = runtimeMetaJson(conversationSummaryKey(payload), { summary: "", messageCount: 0, updatedAt: "" }) ||
      { summary: "", messageCount: 0, updatedAt: "" };
    return { ...state, summary: sanitizeModelVisibleToolText(state.summary) };
  }

  function protocolToolOutputForPersistence(output) {
    if (!Array.isArray(output)) return typeof output === "string" ? output : safeJson(output);
    const persisted = output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      if (String(item.type || "") === "input_image") {
        return [{ type: "input_text", text: "Local image was loaded for that tool turn. Call view_image again when fresh pixels are needed." }];
      }
      if (String(item.type || "") === "input_text") {
        return [{ type: "input_text", text: summarizeText(String(item.text || ""), 2400) }];
      }
      if (String(item.type || "") === "encrypted_content" && item.encrypted_content) {
        return [{ type: "encrypted_content", encrypted_content: String(item.encrypted_content) }];
      }
      return [];
    });
    return persisted.length ? persisted : "Tool completed without persistent text output.";
  }

  function protocolItemForPersistence(item = {}, limits = {}) {
    const type = String(item?.type || "");
    if (type === "message") {
      const messageMaxChars = Math.max(12_000, Math.min(1_200_000, Number(limits.messageChars || 12_000)));
      const content = (Array.isArray(item.content) ? item.content : [])
        .map((part) => {
          const partType = String(part?.type || "");
          if (!["input_text", "output_text"].includes(partType)) return null;
          return { type: partType, text: summarizeText(String(part.text || ""), messageMaxChars) };
        })
        .filter(Boolean);
      return content.length ? { type, role: String(item.role || "assistant"), content } : null;
    }
    if (type === "reasoning") {
      const encrypted = String(item.encrypted_content || "");
      if (!encrypted) return null;
      return {
        type,
        ...(item.id ? { id: String(item.id) } : {}),
        summary: Array.isArray(item.summary) ? item.summary : [],
        encrypted_content: encrypted
      };
    }
    if (type === "function_call") {
      const name = String(item.name || "").trim();
      const callId = String(item.call_id || item.id || "").trim();
      if (!name || !callId) return null;
      const rawArguments = typeof item.arguments === "string" ? item.arguments : safeJson(item.arguments || {});
      const argumentsForPersistence = name === "experience"
        ? safeJson(Object.fromEntries(Object.entries(parseJsonObject(rawArguments)).filter(([key]) => experiencePublicArgumentKeys.has(key))))
        : rawArguments;
      return { type, call_id: callId, name, arguments: argumentsForPersistence };
    }
    if (type === "function_call_output") {
      const callId = String(item.call_id || "").trim();
      if (!callId) return null;
      return { type, call_id: callId, output: protocolToolOutputForPersistence(item.output) };
    }
    if (type === "web_search_call") {
      return {
        type,
        ...(item.id ? { id: String(item.id) } : {}),
        ...(item.status ? { status: String(item.status) } : {}),
        ...(item.action && typeof item.action === "object" ? { action: JSON.parse(safeJson(item.action)) } : {})
      };
    }
    if (["compaction", "context_compaction"].includes(type) && item.encrypted_content) {
      return { type, ...(item.id ? { id: String(item.id) } : {}), encrypted_content: String(item.encrypted_content) };
    }
    return null;
  }

  function protocolStateForPayload(payload = {}) {
    const state = runtimeMetaJson(conversationProtocolKey(payload), { version: 1, turns: [], updatedAt: "" }) ||
      { version: 1, turns: [], updatedAt: "" };
    return {
      version: 1,
      turns: Array.isArray(state.turns) ? state.turns.filter((turn) => Array.isArray(turn?.items)) : [],
      updatedAt: String(state.updatedAt || "")
    };
  }

  function conversationProtocolItemsForPrompt(payload = {}, limits = {}) {
    const turns = protocolStateForPayload(payload).turns;
    const maxTurns = Math.max(1, Number(limits.maxTurns || protocolHistoryMaxTurns));
    const maxPromptChars = Math.max(4_000, Number(limits.promptChars || protocolHistoryPromptChars));
    const selected = [];
    let chars = 0;
    for (const turn of [...turns].reverse()) {
      const turnChars = safeJson(turn.items).length;
      if (selected.length && chars + turnChars > maxPromptChars) break;
      selected.unshift(turn);
      chars += turnChars;
      if (selected.length >= maxTurns) break;
    }
    return selected.flatMap((turn) => turn.items);
  }

  function persistedProtocolItems(items = [], limits = {}) {
    const persistedItems = (Array.isArray(items) ? items : []).map((item) => protocolItemForPersistence(item, limits)).filter(Boolean);
    return persistedItems;
  }

  function appendConversationProtocolTurn(payload = {}, items = [], limits = {}) {
    const persistedItems = persistedProtocolItems(items, limits);
    if (!persistedItems.length) return;
    const maxTurns = Math.max(1, Number(limits.maxTurns || protocolHistoryMaxTurns));
    const maxStoreChars = Math.max(8_000, Number(limits.storeChars || protocolHistoryStoreChars));
    const state = protocolStateForPayload(payload);
    const turns = [...state.turns, { createdAt: new Date().toISOString(), items: persistedItems }].slice(-maxTurns);
    while (turns.length > 1 && safeJson(turns).length > maxStoreChars) turns.shift();
    writeRuntimeMetaJson(conversationProtocolKey(payload), { version: 1, turns, updatedAt: new Date().toISOString() });
  }

  function replaceConversationProtocolItems(payload = {}, items = [], limits = {}) {
    const persistedItems = persistedProtocolItems(items, limits);
    const maxStoreChars = Math.max(8_000, Number(limits.storeChars || protocolHistoryStoreChars));
    while (persistedItems.length > 1 && safeJson(persistedItems).length > maxStoreChars) persistedItems.shift();
    const turns = persistedItems.length ? [{ createdAt: new Date().toISOString(), items: persistedItems }] : [];
    writeRuntimeMetaJson(conversationProtocolKey(payload), { version: 1, turns, updatedAt: new Date().toISOString() });
  }

  function dateMemoryBuffer() {
    const buffer = readJson(dateMemoryPath, { version: 1, entries: [], needs_compaction: false });
    const entries = Array.isArray(buffer.entries) ? buffer.entries : [];
    const bytes = Buffer.byteLength(JSON.stringify({ ...buffer, entries }), "utf8");
    return { ...buffer, entries, bytes, overLimit: bytes >= dateMemoryCompactChars || Boolean(buffer.needs_compaction) };
  }

  function fallbackDateMemoryEntries(entries) {
    const byDate = new Map();
    for (const entry of entries) {
      const date = String(entry.date || entry.date_key || dateKey()).slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(entry);
    }
    return [...byDate.entries()].map(([date, rows]) => {
      const text = rows.map((row) => `[${row.id || row.entry_id}] ${row.role || ""}/${row.title || ""}\n${row.text || ""}`).join("\n\n");
      return {
        date,
        title: `${date} naimage 工作日记`,
        keywords: Array.from(new Set(["naimage", "Agent", "绘图", ...rows.flatMap((row) => splitKeywords(row.title))])).slice(0, 12),
        sourceEntryIds: rows.map((row) => String(row.id || row.entry_id || "")).filter(Boolean),
        content: summarizeText(text, 3600)
      };
    });
  }

  function dispose() {
    if (!db) return;
    try {
      db.close();
    } finally {
      db = null;
    }
  }

  function diagnostics() {
    return {
      sqlite: Boolean(DatabaseSync),
      dbPath,
      dateMemoryPath,
      promptMemoryPath,
      fastMemoryPath,
      memoryContextPath
    };
  }

  return {
    appendConversationProtocolTurn,
    clearConversationState,
    compact,
    compactStateForPayload,
    contextManage,
    conversationProtocolItemsForPrompt,
    conversationSummaryKey,
    dateMemoryBuffer,
    diagnostics,
    dispose,
    ensureMemory,
    experienceManage,
    externalPromptFor,
    fallbackDateMemoryEntries,
    fastMemoryForPrompt,
    getFastMemory,
    getMainPrompt,
    memoryAdd,
    memoryCheck,
    memoryContextForPrompt,
    memoryRead,
    recentContextForPrompt,
    recordContextEntry,
    replaceConversationProtocolItems,
    requiredFastMemoryScope,
    resetFastMemory,
    resetMainPrompt,
    saveFastMemory,
    saveMainPrompt,
    storeToolResult,
    writeRuntimeMetaJson
  };
}

module.exports = { createMemoryStore };
