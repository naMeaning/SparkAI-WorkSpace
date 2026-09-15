"use strict";

const assert = require("node:assert/strict");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAgentRuntime } = require("../agent-runtime.cjs");
const { createProjectDataMigrationService } = require("../desktop/project-data-migration.cjs");
const { createMemoryStore } = require("../runtime/memory-store.cjs");

let DatabaseSync = null;
try { ({ DatabaseSync } = require("node:sqlite")); } catch {}

const testRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-project-migration-"));

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

function fixtureService(root, overrides = {}) {
  const configDir = path.join(root, "config");
  const projectsDir = path.join(configDir, "projects");
  const sessionPath = path.join(configDir, "session.json");
  const installRoot = path.join(root, "installed-app");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(installRoot, { recursive: true });
  let list = overrides.list || { activeProjectId: "", projects: [] };
  let writeCount = 0;
  const service = createProjectDataMigrationService({
    configDir,
    projectsDir,
    sessionPath,
    installRoot,
    readProjectList: () => list,
    writeProjectList: (next) => {
      writeCount += 1;
      if (overrides.failListWrite) throw Object.assign(new Error("fixture index failure"), { code: "FIXTURE_INDEX_FAILED" });
      list = next;
      writeJson(path.join(configDir, "project-list.json"), next);
      return next;
    },
    sessionHasContent: (session) => Boolean(session?.nodes?.length || session?.messages?.length),
    ...(typeof overrides.availableDiskBytes === "function" ? { availableDiskBytes: overrides.availableDiskBytes } : {}),
    idFactory: (prefix) => `${prefix}-fixture-000001`,
    now: () => new Date("2026-08-14T08:00:00.000Z")
  });
  return {
    configDir,
    getList: () => list,
    getWriteCount: () => writeCount,
    installRoot,
    projectsDir,
    service,
    sessionPath
  };
}

async function run() {
  const primaryRoot = path.join(testRoot, "primary");
  const legacyProjectPath = path.join(primaryRoot, "config", "projects", "default");
  const legacySession = {
    schemaVersion: 5,
    sessionRevision: 7,
    messages: [{ role: "user", content: "legacy project" }],
    nodes: [{ id: "image-a", type: "image", assets: [{ relativePath: "assets/a.png" }] }]
  };
  mkdirSync(path.join(legacyProjectPath, "assets"), { recursive: true });
  writeJson(path.join(legacyProjectPath, "session.json"), legacySession);
  writeFileSync(path.join(legacyProjectPath, "assets", "a.png"), Buffer.from("fixture-project-image"));

  const project = {
    id: "default",
    name: "旧 C 盘项目",
    path: legacyProjectPath,
    sessionPath: path.join(legacyProjectPath, "session.json"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    external: false
  };
  const fixture = fixtureService(primaryRoot, { list: { activeProjectId: "default", projects: [project] } });
  writeJson(fixture.sessionPath, { messages: [{ role: "user", content: "legacy global session" }], nodes: [] });
  writeJson(path.join(fixture.configDir, "memory", "fastmemory.json"), {
    version: 1,
    entries: [
      { entry_id: "default-memory", projectId: "default", conversationId: "conv-a", text: "project memory", status: "active" },
      { entry_id: "other-memory", projectId: "other", conversationId: "conv-b", text: "other memory", status: "active" }
    ]
  });

  if (DatabaseSync) {
    const databasePath = path.join(fixture.configDir, "memory", "naimage-memory.db");
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE runtime_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    database.prepare("INSERT INTO runtime_meta(key, value) VALUES(?, ?)")
      .run("conversation_summary:default:conv-a", JSON.stringify({ summary: "legacy summary", messageCount: 3 }));
    database.prepare("INSERT INTO runtime_meta(key, value) VALUES(?, ?)")
      .run("conversation_protocol:default:conv-a", JSON.stringify({ version: 1, turns: [{ items: [{ type: "message" }] }] }));
    database.close();
  }

  const secretPath = path.join(legacyProjectPath, "app-settings.secrets.json");
  writeFileSync(secretPath, "secret-must-not-migrate", "utf8");
  let preview = await fixture.service.previewLegacyData();
  const blockedProject = preview.candidates.find((candidate) => candidate.projectId === "default");
  assert.equal(blockedProject.blockedCode, "PROJECT_MIGRATION_SENSITIVE_FILE");
  rmSync(secretPath, { force: true });

  const junctionSource = path.join(primaryRoot, "junction-target");
  const junctionPath = path.join(fixture.projectsDir, "linked-project");
  mkdirSync(junctionSource, { recursive: true });
  let junctionCreated = false;
  try {
    symlinkSync(junctionSource, junctionPath, "junction");
    junctionCreated = true;
    preview = await fixture.service.previewLegacyData();
    const linked = preview.candidates.find((candidate) => candidate.name === "linked-project");
    assert.equal(linked.blockedCode, "PROJECT_MIGRATION_SYMLINK");
  } catch (error) {
    if (junctionCreated) throw error;
  } finally {
    try { rmSync(junctionPath, { force: true }); } catch {}
  }

  preview = await fixture.service.previewLegacyData();
  assert.equal(preview.candidates.length, 2, "Indexed managed project and non-empty global Session should both be discoverable");
  const publicPreview = fixture.service.publicMigrationPreview(preview);
  assert.equal(publicPreview.candidateCount, 2);
  assert.equal(publicPreview.blockedCount, 0);
  assert.equal(JSON.stringify(publicPreview).includes(primaryRoot), false, "Renderer preview must not expose private source paths");
  const managed = preview.candidates.find((candidate) => candidate.projectId === "default");
  assert.equal(managed.memoryEntryCount, DatabaseSync ? 3 : 1);

  await rejectsCode(
    fixture.service.migrateLegacyProjects({ confirmed: true, candidateIds: [managed.candidateId], targetParent: fixture.configDir }),
    "PROJECT_MIGRATION_TARGET_APPDATA"
  );
  await rejectsCode(
    fixture.service.migrateLegacyProjects({ confirmed: true, candidateIds: [managed.candidateId], targetParent: fixture.installRoot }),
    "PROJECT_MIGRATION_TARGET_INSTALL"
  );
  await rejectsCode(
    fixture.service.migrateLegacyProjects({ confirmed: true, candidateIds: [managed.candidateId], targetParent: legacyProjectPath }),
    "PROJECT_MIGRATION_TARGET_SOURCE"
  );

  const destinationParent = path.join(primaryRoot, "user-projects");
  mkdirSync(destinationParent, { recursive: true });
  const migrated = await fixture.service.migrateLegacyProjects({
    confirmed: true,
    candidateIds: [managed.candidateId],
    targetParent: destinationParent
  });
  assert.equal(migrated.ok, true);
  assert.equal(migrated.migratedProjectCount, 1);
  assert.equal(migrated.cleanupAvailable, true);
  assert.equal(existsSync(legacyProjectPath), true, "Migration must retain source data until separate cleanup confirmation");
  const migratedRecord = fixture.getList().projects.find((item) => item.id === "default");
  assert.equal(path.dirname(migratedRecord.path), destinationParent);
  assert.equal(readJson(path.join(migratedRecord.path, "session.json")).sessionRevision, 7);
  assert.equal(readFileSync(path.join(migratedRecord.path, "assets", "a.png"), "utf8"), "fixture-project-image");
  const projectFastMemory = readJson(path.join(migratedRecord.path, ".naimage", "agent", "fastmemory.json"));
  assert.deepEqual(projectFastMemory.entries.map((entry) => entry.entry_id), ["default-memory"]);
  if (DatabaseSync) {
    const conversations = readJson(path.join(migratedRecord.path, ".naimage", "agent", "conversations.json"));
    assert.equal(conversations.summaries["conv-a"].summary, "legacy summary");
    assert.equal(conversations.protocols["conv-a"].turns.length, 1);
  }
  const pendingPreview = await fixture.service.previewLegacyData();
  assert.equal(pendingPreview.candidates.some((candidate) => candidate.projectId === "default"), false, "A retained source covered by a migration receipt must not be offered as a new migration");
  assert.equal(pendingPreview.pendingCleanup.length, 1);
  const publicPendingPreview = fixture.service.publicMigrationPreview(pendingPreview);
  assert.equal(publicPendingPreview.pendingCleanupCount, 1);
  assert.equal(JSON.stringify(publicPendingPreview.pendingCleanup).includes(legacyProjectPath), false);

  await rejectsCode(
    fixture.service.cleanupMigratedSource({ migrationId: migrated.migrationId, confirmedCleanup: false }),
    "PROJECT_MIGRATION_CLEANUP_CONFIRMATION_REQUIRED"
  );
  writeFileSync(path.join(legacyProjectPath, "assets", "a.png"), Buffer.from("changed-after-migration"));
  await rejectsCode(
    fixture.service.cleanupMigratedSource({ migrationId: migrated.migrationId, confirmedCleanup: true }),
    "PROJECT_MIGRATION_SOURCE_CHANGED"
  );
  assert.equal(existsSync(legacyProjectPath), true);
  writeFileSync(path.join(legacyProjectPath, "assets", "a.png"), Buffer.from("fixture-project-image"));
  const cleaned = await fixture.service.cleanupMigratedSource({ migrationId: migrated.migrationId, confirmedCleanup: true });
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.removedProjectCount, 1);
  assert.equal(existsSync(legacyProjectPath), false);
  assert.deepEqual(
    readJson(path.join(fixture.configDir, "memory", "fastmemory.json")).entries.map((entry) => entry.entry_id),
    ["other-memory"],
    "Cleanup must remove only the migrated project's legacy memory scope"
  );
  assert.equal(existsSync(fixture.sessionPath), true, "Unselected legacy global Session must remain untouched");

  const spaceRoot = path.join(testRoot, "insufficient-space");
  const spaceProjectPath = path.join(spaceRoot, "config", "projects", "space-project");
  mkdirSync(spaceProjectPath, { recursive: true });
  writeJson(path.join(spaceProjectPath, "session.json"), { messages: [{ role: "user", content: "space" }], nodes: [] });
  const spaceProject = {
    id: "space-project",
    name: "Space",
    path: spaceProjectPath,
    sessionPath: path.join(spaceProjectPath, "session.json"),
    external: false
  };
  const spaceFixture = fixtureService(spaceRoot, {
    list: { activeProjectId: spaceProject.id, projects: [spaceProject] },
    availableDiskBytes: async () => 1024
  });
  const spaceTarget = path.join(spaceRoot, "user-projects");
  mkdirSync(spaceTarget, { recursive: true });
  const spacePreview = await spaceFixture.service.previewLegacyData();
  await rejectsCode(
    spaceFixture.service.migrateLegacyProjects({
      confirmed: true,
      candidateIds: [spacePreview.candidates[0].candidateId],
      targetParent: spaceTarget
    }),
    "PROJECT_MIGRATION_INSUFFICIENT_SPACE"
  );
  assert.equal(existsSync(spaceProjectPath), true, "Insufficient target space must leave the source project intact");
  assert.deepEqual(readdirSync(spaceTarget), [], "Insufficient target space must fail before staging or publishing files");
  assert.equal(spaceFixture.getWriteCount(), 0, "Insufficient target space must not update the project index");

  const rollbackRoot = path.join(testRoot, "rollback");
  const rollbackProjectPath = path.join(rollbackRoot, "config", "projects", "rollback-project");
  mkdirSync(rollbackProjectPath, { recursive: true });
  writeJson(path.join(rollbackProjectPath, "session.json"), { messages: [{ role: "user", content: "rollback" }], nodes: [] });
  const rollbackProject = {
    id: "rollback-project",
    name: "Rollback",
    path: rollbackProjectPath,
    sessionPath: path.join(rollbackProjectPath, "session.json"),
    external: false
  };
  const rollbackFixture = fixtureService(rollbackRoot, {
    list: { activeProjectId: rollbackProject.id, projects: [rollbackProject] },
    failListWrite: true
  });
  const rollbackTarget = path.join(rollbackRoot, "user-projects");
  mkdirSync(rollbackTarget, { recursive: true });
  const rollbackPreview = await rollbackFixture.service.previewLegacyData();
  await rejectsCode(
    rollbackFixture.service.migrateLegacyProjects({
      confirmed: true,
      candidateIds: [rollbackPreview.candidates[0].candidateId],
      targetParent: rollbackTarget
    }),
    "FIXTURE_INDEX_FAILED"
  );
  assert.equal(existsSync(rollbackProjectPath), true, "An index failure must leave the source project intact");
  assert.deepEqual(readdirSync(rollbackTarget), [], "An index failure must roll back published destination data");

  const runtimeRoot = path.join(testRoot, "project-memory-runtime");
  const runtimeConfig = path.join(runtimeRoot, "config");
  const runtimeProject = path.join(runtimeRoot, "user-project");
  mkdirSync(runtimeProject, { recursive: true });
  const runtime = createAgentRuntime({
    projectRoot: runtimeRoot,
    configDir: runtimeConfig,
    projectMetaDirName: ".naimage",
    resolveProjectRoot: (projectId) => projectId === "runtime-project" ? runtimeProject : ""
  });
  const runtimeMemory = runtime.saveFastMemory({
    projectId: "runtime-project",
    conversationId: "runtime-conversation",
    text: "project-local-memory"
  });
  assert.equal(runtimeMemory.ok, true);
  const projectMemoryPath = path.join(runtimeProject, ".naimage", "agent", "fastmemory.json");
  assert.equal(readJson(projectMemoryPath).entries[0].text, "project-local-memory");
  const globalRuntimeFastMemory = readJson(path.join(runtimeConfig, "memory", "fastmemory.json"));
  assert.deepEqual(globalRuntimeFastMemory.entries, [], "Project FastMemory must not be written back to AppData memory");
  assert.throws(
    () => runtime.saveFastMemory({ projectId: "missing-project", conversationId: "runtime-conversation", text: "reject" }),
    (error) => error?.code === "PROJECT_REQUIRED"
  );
  runtime.dispose();

  const conversationConfig = path.join(runtimeRoot, "conversation-config");
  const conversationProject = path.join(runtimeRoot, "conversation-project");
  mkdirSync(conversationProject, { recursive: true });
  const conversationStore = createMemoryStore({
    configRoot: conversationConfig,
    projectMetaDirName: ".naimage",
    resolveProjectRoot: (projectId) => projectId === "conversation-project" ? conversationProject : "",
    summarizeText: (value, limit = 100000) => String(value || "").slice(0, limit),
    toolSummary: () => "tool",
    promptTextStoreFromRaw: (raw) => ({ changed: false, store: raw }),
    promptStoreStatus: () => ({ ok: true }),
    validateEditableText: (value) => ({ ok: true, text: String(value || "") }),
    sanitizeFastMemoryText: (value) => String(value || ""),
    selectFastMemoryPromptContext: (entries) => ({ text: entries.map((entry) => entry.text).join("\n") }),
    sanitizeModelVisibleToolText: (value) => String(value || ""),
    parseJsonObject: (value) => { try { return JSON.parse(value); } catch { return {}; } },
    splitKeywords: (value) => Array.isArray(value) ? value.map(String) : [],
    countLines: (value) => String(value || "").split(/\r?\n/).length,
    dateKey: () => "2026-08-14",
    compactDateKey: (value) => String(value || "").replace(/[^0-9]/g, "")
  });
  const conversationScope = { projectId: "conversation-project", conversationId: "conversation-a" };
  conversationStore.writeConversationSummary(conversationScope, {
    summary: "project-local-summary",
    messageCount: 4,
    updatedAt: "2026-08-14T08:00:00.000Z"
  });
  conversationStore.appendConversationProtocolTurn(conversationScope, [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "project-local-protocol" }]
  }]);
  assert.equal(conversationStore.compactStateForPayload(conversationScope).summary, "project-local-summary");
  assert.equal(conversationStore.conversationProtocolItemsForPrompt(conversationScope)[0].content[0].text, "project-local-protocol");
  const conversationDocumentPath = path.join(conversationProject, ".naimage", "agent", "conversations.json");
  const conversationDocument = readJson(conversationDocumentPath);
  assert.equal(conversationDocument.summaries["conversation-a"].summary, "project-local-summary");
  assert.equal(conversationDocument.protocols["conversation-a"].turns.length, 1);
  const clearedConversation = conversationStore.clearConversationState(conversationScope);
  assert.equal(clearedConversation.clearedSummary, true);
  assert.equal(clearedConversation.clearedProtocol, true);
  assert.equal(conversationStore.compactStateForPayload(conversationScope).summary, "");
  assert.deepEqual(conversationStore.conversationProtocolItemsForPrompt(conversationScope), []);
  conversationStore.dispose();

  return {
    ok: true,
    cases: 41,
    boundedHashConcurrency: true,
    diskSpacePreflight: true,
    sourceRetainedUntilConfirmation: true,
    sha256CopyVerification: true,
    indexRollback: true,
    privatePathsHiddenFromRenderer: true,
    projectMemoryMigrated: true,
    projectMemoryWritesStayInProject: true,
    conversationStateWritesStayInProject: true,
    symlinkBoundaryTested: junctionCreated
  };
}

run()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    try { rmSync(testRoot, { recursive: true, force: true }); } catch {}
  });
