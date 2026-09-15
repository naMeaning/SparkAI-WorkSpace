"use strict";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nodeSequenceFromCode(value) {
  const code = cleanString(value).toUpperCase();
  if (/^[A-Z]$/.test(code)) return code.charCodeAt(0) - 64;
  const numbered = code.match(/^N(\d+)$/);
  return numbered ? Math.max(0, Number(numbered[1]) || 0) : 0;
}

function nodeCodeForSequence(sequence) {
  const normalized = Math.max(1, Math.floor(Number(sequence) || 1));
  return normalized <= 26 ? String.fromCharCode(64 + normalized) : `N${normalized}`;
}

function nodeOrigin(node) {
  const explicit = cleanString(node?.persistenceOriginId);
  if (explicit) return explicit;
  return `legacy:${cleanString(node?.id)}:${cleanString(node?.createdAt)}:${cleanString(node?.type)}`;
}

function sameLogicalNode(left, right) {
  return Boolean(left && right && nodeOrigin(left) === nodeOrigin(right));
}

function normalizeNodeMutationEvent(value) {
  if (!value || typeof value !== "object") return null;
  const eventId = cleanString(value.eventId).slice(0, 420);
  const writerId = cleanString(value.writerId).slice(0, 200);
  const nodeOriginId = cleanString(value.nodeOriginId).slice(0, 200);
  const nodeId = cleanString(value.nodeId).slice(0, 200);
  const kind = value.kind === "delete" ? "delete" : value.kind === "restore" ? "restore" : value.kind === "upsert" ? "upsert" : "";
  if (!eventId || !writerId || !nodeOriginId || !nodeId || !kind) return null;
  const commitRevision = Number(value.commitRevision);
  const fields = Array.isArray(value.fields)
    ? [...new Set(value.fields.map((field) => cleanString(field).slice(0, 120)).filter(Boolean))].slice(0, 160)
    : [];
  return {
    version: 1,
    eventId,
    writerId,
    writerSequence: Math.max(0, Math.floor(Number(value.writerSequence) || 0)),
    baseRevision: Math.max(0, Math.floor(Number(value.baseRevision) || 0)),
    ...(Number.isSafeInteger(commitRevision) && commitRevision >= 0 ? { commitRevision } : {}),
    kind,
    ...(kind !== "delete" ? { fields: fields.length ? fields : ["*"] } : {}),
    ...(kind === "restore" && cleanString(value.restoresEventId) ? { restoresEventId: cleanString(value.restoresEventId).slice(0, 420) } : {}),
    nodeOriginId,
    nodeId,
    createdAt: cleanString(value.createdAt).slice(0, 120) || new Date(0).toISOString()
  };
}

function nodeMutationFields(event) {
  return Array.isArray(event?.fields) && event.fields.length ? event.fields : ["*"];
}

function nodeMutationEventOrder(event) {
  return [
    Math.max(0, Math.floor(Number(event?.commitRevision) || 0)),
    Math.max(0, Math.floor(Number(event?.baseRevision) || 0)),
    Math.max(0, Math.floor(Number(event?.writerSequence) || 0)),
    cleanString(event?.createdAt),
    cleanString(event?.eventId)
  ];
}

function laterNodeMutationEvent(left, right) {
  const leftOrder = nodeMutationEventOrder(left);
  const rightOrder = nodeMutationEventOrder(right);
  for (let index = 0; index < leftOrder.length; index += 1) {
    if (leftOrder[index] === rightOrder[index]) continue;
    return leftOrder[index] > rightOrder[index];
  }
  return false;
}

function normalizeNodeMutationJournal(value) {
  const byId = new Map();
  for (const rawEvent of Array.isArray(value) ? value : []) {
    const event = normalizeNodeMutationEvent(rawEvent);
    if (!event) continue;
    const previous = byId.get(event.eventId);
    if (!previous || laterNodeMutationEvent(event, previous)) byId.set(event.eventId, event);
  }
  return [...byId.values()];
}

function compactNodeMutationJournal(value) {
  const deletes = new Map();
  const restores = new Map();
  const upserts = new Map();
  for (const event of normalizeNodeMutationJournal(value)) {
    if (event.kind === "delete") {
      const previous = deletes.get(event.nodeOriginId);
      if (!previous || laterNodeMutationEvent(event, previous)) deletes.set(event.nodeOriginId, event);
      continue;
    }
    if (event.kind === "restore") {
      const previous = restores.get(event.nodeOriginId);
      if (!previous || laterNodeMutationEvent(event, previous)) restores.set(event.nodeOriginId, event);
      continue;
    }
    for (const field of nodeMutationFields(event)) {
      const key = `${event.nodeOriginId}\u0000${event.writerId}\u0000${field}`;
      const previous = upserts.get(key);
      if (!previous || laterNodeMutationEvent(event, previous)) upserts.set(key, event);
    }
  }
  const result = [];
  const origins = new Set([
    ...deletes.keys(),
    ...restores.keys(),
    ...[...upserts.values()].map((event) => event.nodeOriginId)
  ]);
  for (const origin of origins) {
    const deletion = deletes.get(origin);
    const restoration = restores.get(origin);
    const validRestoration = Boolean(
      deletion &&
      restoration?.restoresEventId === deletion.eventId &&
      restoration.baseRevision >= (deletion.commitRevision ?? deletion.baseRevision)
    );
    if (deletion) result.push(deletion);
    if (validRestoration && restoration) result.push(restoration);
    if (!deletion || validRestoration) {
      result.push(...new Map([...upserts.values()].filter((event) => (
        event.nodeOriginId === origin &&
        (!validRestoration || event.baseRevision >= (restoration?.commitRevision ?? restoration?.baseRevision ?? 0))
      )).map((event) => [event.eventId, event])).values());
    }
  }
  return result.sort((left, right) => laterNodeMutationEvent(left, right) ? 1 : laterNodeMutationEvent(right, left) ? -1 : 0);
}

const DEFAULT_WRITER_CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeNodeMutationWriterCheckpoint(value) {
  if (!value || typeof value !== "object") return null;
  const writerId = cleanString(value.writerId).slice(0, 200);
  if (!writerId) return null;
  return {
    version: 1,
    writerId,
    writerSequence: Math.max(0, Math.floor(Number(value.writerSequence) || 0)),
    observedRevision: Math.max(0, Math.floor(Number(value.observedRevision) || 0)),
    lastSeenAt: cleanString(value.lastSeenAt).slice(0, 120) || new Date(0).toISOString()
  };
}

function normalizeNodeMutationWriterCheckpoints(value) {
  const byWriter = new Map();
  for (const raw of Array.isArray(value) ? value : []) {
    const checkpoint = normalizeNodeMutationWriterCheckpoint(raw);
    if (!checkpoint) continue;
    const previous = byWriter.get(checkpoint.writerId);
    byWriter.set(checkpoint.writerId, {
      ...checkpoint,
      writerSequence: Math.max(previous?.writerSequence || 0, checkpoint.writerSequence),
      observedRevision: Math.max(previous?.observedRevision || 0, checkpoint.observedRevision),
      lastSeenAt: cleanString(previous?.lastSeenAt) > checkpoint.lastSeenAt ? previous.lastSeenAt : checkpoint.lastSeenAt
    });
  }
  return [...byWriter.values()].sort((left, right) => left.writerId.localeCompare(right.writerId));
}

function mergeNodeMutationWriterCheckpoints(existingValue, incomingValue, journals, options = {}) {
  const byWriter = new Map();
  const incomingWriterId = cleanString(options.incomingWriterId).slice(0, 200);
  const existingEventIds = new Set(journals.existing.map((event) => event.eventId));
  const activeIncomingWriters = new Set(incomingWriterId ? [incomingWriterId] : journals.incoming
    .filter((event) => !existingEventIds.has(event.eventId))
    .map((event) => event.writerId));
  const merge = (raw, seenNow = false) => {
    const checkpoint = normalizeNodeMutationWriterCheckpoint(raw);
    if (!checkpoint) return;
    const previous = byWriter.get(checkpoint.writerId);
    byWriter.set(checkpoint.writerId, {
      ...checkpoint,
      writerSequence: Math.max(previous?.writerSequence || 0, checkpoint.writerSequence),
      observedRevision: Math.max(previous?.observedRevision || 0, checkpoint.observedRevision),
      lastSeenAt: seenNow
        ? options.nowIso
        : cleanString(previous?.lastSeenAt) > checkpoint.lastSeenAt ? previous.lastSeenAt : checkpoint.lastSeenAt
    });
  };
  for (const checkpoint of Array.isArray(existingValue) ? existingValue : []) merge(checkpoint);
  for (const checkpoint of Array.isArray(incomingValue) ? incomingValue : []) {
    const writerId = cleanString(checkpoint?.writerId).slice(0, 200);
    merge(checkpoint, activeIncomingWriters.has(writerId));
  }
  for (const event of journals.existing) {
    if (!byWriter.has(event.writerId)) merge({
      writerId: event.writerId,
      writerSequence: event.writerSequence,
      observedRevision: event.baseRevision,
      lastSeenAt: event.createdAt
    });
  }
  for (const event of journals.incoming) merge({
    writerId: event.writerId,
    writerSequence: event.writerSequence,
    observedRevision: event.baseRevision,
    lastSeenAt: activeIncomingWriters.has(event.writerId) ? options.nowIso : event.createdAt
  }, activeIncomingWriters.has(event.writerId));
  const cutoff = options.nowMs - options.retentionMs;
  return [...byWriter.values()]
    .filter((checkpoint) => {
      const lastSeen = Date.parse(checkpoint.lastSeenAt);
      return Number.isFinite(lastSeen) && lastSeen >= cutoff;
    })
    .sort((left, right) => left.writerId.localeCompare(right.writerId));
}

function normalizeNodeMutationBarrier(value) {
  if (!value || typeof value !== "object") return null;
  const nodeOriginId = cleanString(value.nodeOriginId).slice(0, 200);
  const eventId = cleanString(value.eventId).slice(0, 420);
  const kind = value.kind === "delete" ? "delete" : value.kind === "restore" ? "restore" : "";
  if (!nodeOriginId || !eventId || !kind) return null;
  return {
    version: 1,
    nodeOriginId,
    nodeId: cleanString(value.nodeId).slice(0, 200),
    eventId,
    kind,
    commitRevision: Math.max(0, Math.floor(Number(value.commitRevision) || 0)),
    createdAt: cleanString(value.createdAt).slice(0, 120) || new Date(0).toISOString()
  };
}

function mergeNodeMutationBarriers(existingValue, incomingValue) {
  const byOrigin = new Map();
  for (const raw of [...(Array.isArray(existingValue) ? existingValue : []), ...(Array.isArray(incomingValue) ? incomingValue : [])]) {
    const barrier = normalizeNodeMutationBarrier(raw);
    if (!barrier) continue;
    const previous = byOrigin.get(barrier.nodeOriginId);
    if (!previous || barrier.commitRevision > previous.commitRevision || (
      barrier.commitRevision === previous.commitRevision && barrier.eventId > previous.eventId
    )) byOrigin.set(barrier.nodeOriginId, barrier);
  }
  return byOrigin;
}

function normalizeNodeMutationBarriers(value) {
  return [...mergeNodeMutationBarriers(value, []).values()]
    .sort((left, right) => left.nodeOriginId.localeCompare(right.nodeOriginId));
}

function stableNodeValue(value) {
  if (Array.isArray(value)) return value.map(stableNodeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableNodeValue(child)])
  );
}

function changedNodeFields(previous, current) {
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter((field) => JSON.stringify(stableNodeValue(previous[field])) !== JSON.stringify(stableNodeValue(current[field])))
    .sort();
}

function activeNodeMutationTombstone(journalValue, barrierValue, origin) {
  const events = compactNodeMutationJournal(journalValue).filter((event) => event.nodeOriginId === origin);
  const deletion = events.find((event) => event.kind === "delete");
  if (deletion) {
    const restoration = events.find((event) => event.kind === "restore" && event.restoresEventId === deletion.eventId);
    if (!restoration) return deletion;
  }
  const barrier = normalizeNodeMutationBarriers(barrierValue)
    .find((item) => item.nodeOriginId === origin && item.kind === "delete");
  return barrier ? {
    version: 1,
    eventId: barrier.eventId,
    writerId: "checkpoint-gc",
    writerSequence: 0,
    baseRevision: barrier.commitRevision,
    commitRevision: barrier.commitRevision,
    kind: "delete",
    nodeOriginId: barrier.nodeOriginId,
    nodeId: barrier.nodeId,
    createdAt: barrier.createdAt
  } : undefined;
}

function collectNodeMutationEvents(input = {}) {
  const writerId = cleanString(input.writerId).slice(0, 200);
  if (!writerId) throw new Error("node mutation writerId is required");
  let nextWriterSequence = Math.max(0, Math.floor(Number(input.nextWriterSequence) || 0));
  const baseRevision = Math.max(0, Math.floor(Number(input.baseRevision) || 0));
  const now = typeof input.now === "function" ? input.now : () => new Date().toISOString();
  const baselineNodes = Array.isArray(input.baselineNodes) ? input.baselineNodes : [];
  const currentNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const baselineByOrigin = new Map(baselineNodes.map((node) => [nodeOrigin(node), node]));
  const currentByOrigin = new Map(currentNodes.map((node) => [nodeOrigin(node), node]));
  const events = [];

  const append = (kind, origin, nodeId, restoresEventId = "", fields = []) => {
    nextWriterSequence += 1;
    events.push({
      version: 1,
      eventId: `${writerId}:${nextWriterSequence}`,
      writerId,
      writerSequence: nextWriterSequence,
      baseRevision,
      kind,
      ...(kind !== "delete" ? { fields: fields.length ? fields : ["*"] } : {}),
      ...(restoresEventId ? { restoresEventId } : {}),
      nodeOriginId: cleanString(origin).slice(0, 200),
      nodeId: cleanString(nodeId).slice(0, 200),
      createdAt: now()
    });
  };

  for (const [origin, node] of currentByOrigin) {
    const previous = baselineByOrigin.get(origin);
    if (!previous) {
      const tombstone = activeNodeMutationTombstone(input.journal, input.barriers, origin);
      append(tombstone ? "restore" : "upsert", origin, node.id, tombstone?.eventId, ["*"]);
    } else if (JSON.stringify(stableNodeValue(previous)) !== JSON.stringify(stableNodeValue(node))) {
      append("upsert", origin, node.id, "", changedNodeFields(previous, node));
    }
  }
  for (const [origin, node] of baselineByOrigin) {
    if (!currentByOrigin.has(origin)) append("delete", origin, node.id);
  }

  return {
    events,
    // New events do not have a commitRevision until the save coordinator
    // accepts them. Keep them beside the committed journal here; compacting
    // now would make an older committed event win the same field and discard
    // the pending mutation before it can be stamped.
    journal: [
      ...compactNodeMutationJournal(Array.isArray(input.journal) ? input.journal : []),
      ...events
    ],
    nextWriterSequence
  };
}

function updateNodeMutationWriterCheckpoint(value, checkpoint) {
  return normalizeNodeMutationWriterCheckpoints([
    ...(Array.isArray(value) ? value : []),
    { version: 1, ...checkpoint }
  ]);
}

function prepareIncomingNodeMutationSession(existingSession, incomingSession, options = {}) {
  const incoming = incomingSession && typeof incomingSession === "object" ? clone(incomingSession) : {};
  const writerId = cleanString(options.writerId).slice(0, 200);
  if (!writerId || !Array.isArray(options.baselineNodes)) {
    return { session: incoming, events: [], nextWriterSequence: 0 };
  }
  const existing = existingSession && typeof existingSession === "object" ? existingSession : {};
  const writerSequences = [
    Math.max(0, Math.floor(Number(options.nextWriterSequence) || 0)),
    ...normalizeNodeMutationJournal(existing.nodeMutationJournal)
      .filter((event) => event.writerId === writerId)
      .map((event) => event.writerSequence),
    ...normalizeNodeMutationJournal(incoming.nodeMutationJournal)
      .filter((event) => event.writerId === writerId)
      .map((event) => event.writerSequence),
    ...normalizeNodeMutationWriterCheckpoints(existing.nodeMutationWriterCheckpoints)
      .filter((checkpoint) => checkpoint.writerId === writerId)
      .map((checkpoint) => checkpoint.writerSequence),
    ...normalizeNodeMutationWriterCheckpoints(incoming.nodeMutationWriterCheckpoints)
      .filter((checkpoint) => checkpoint.writerId === writerId)
      .map((checkpoint) => checkpoint.writerSequence)
  ];
  const observedRevision = Math.max(0, Math.floor(Number(
    options.observedRevision ?? (Number(incoming.sessionRevision) || 1) - 1
  ) || 0));
  const requestedNow = options.now instanceof Date ? options.now.getTime() : Date.parse(cleanString(options.now));
  const nowIso = new Date(Number.isFinite(requestedNow) ? requestedNow : Date.now()).toISOString();
  const collected = collectNodeMutationEvents({
    nodes: incoming.nodes,
    baselineNodes: options.baselineNodes,
    journal: incoming.nodeMutationJournal,
    barriers: incoming.nodeMutationBarriers,
    writerId,
    nextWriterSequence: Math.max(...writerSequences),
    baseRevision: observedRevision,
    now: () => nowIso
  });
  incoming.schemaVersion = Math.max(5, Number(incoming.schemaVersion) || 0);
  incoming.nodeMutationJournal = collected.journal;
  incoming.nodeMutationWriterCheckpoints = updateNodeMutationWriterCheckpoint(
    incoming.nodeMutationWriterCheckpoints,
    {
      writerId,
      writerSequence: collected.nextWriterSequence,
      observedRevision,
      lastSeenAt: nowIso
    }
  );
  incoming.nodeMutationBarriers = normalizeNodeMutationBarriers(incoming.nodeMutationBarriers);
  return { session: incoming, events: collected.events, nextWriterSequence: collected.nextWriterSequence };
}

function eventAllowedByBarrier(event, barrier, restoration) {
  if (!barrier) return true;
  if (event.kind === "restore") {
    return barrier.kind === "delete" &&
      event.restoresEventId === barrier.eventId &&
      event.baseRevision >= barrier.commitRevision;
  }
  if (barrier.kind === "delete" && restoration) {
    return event.baseRevision >= (restoration.commitRevision ?? restoration.baseRevision);
  }
  if (event.baseRevision < barrier.commitRevision) return false;
  return barrier.kind !== "delete" || event.kind === "delete";
}

function mergeNodeMutationJournals(existingValue, incomingValue, barrierValues, checkpoints, nextRevision) {
  const existing = normalizeNodeMutationJournal(existingValue);
  const existingById = new Map(existing.map((event) => [event.eventId, event]));
  const incoming = normalizeNodeMutationJournal(incomingValue);
  const barriers = mergeNodeMutationBarriers(barrierValues.existing, barrierValues.incoming);
  const barrierRestorations = new Map();
  for (const event of [...existing, ...incoming]) {
    const barrier = barriers.get(event.nodeOriginId);
    if (event.kind !== "restore" || barrier?.kind !== "delete" || event.restoresEventId !== barrier.eventId || event.baseRevision < barrier.commitRevision) continue;
    const previous = barrierRestorations.get(event.nodeOriginId);
    if (!previous || laterNodeMutationEvent(event, previous)) barrierRestorations.set(event.nodeOriginId, event);
  }
  const newIncomingEventIds = new Set();
  const rejectedIncomingOrigins = new Set();
  const syntheticBarrierEventIds = new Set();
  const combined = existing.filter((event) => eventAllowedByBarrier(
    event,
    barriers.get(event.nodeOriginId),
    barrierRestorations.get(event.nodeOriginId)
  ));
  for (const barrier of barriers.values()) {
    if (barrier.kind !== "delete") continue;
    syntheticBarrierEventIds.add(barrier.eventId);
    combined.push({
      version: 1,
      eventId: barrier.eventId,
      writerId: "checkpoint-gc",
      writerSequence: 0,
      baseRevision: barrier.commitRevision,
      commitRevision: barrier.commitRevision,
      kind: "delete",
      nodeOriginId: barrier.nodeOriginId,
      nodeId: barrier.nodeId,
      createdAt: barrier.createdAt
    });
  }
  for (const event of incoming) {
    const persisted = existingById.get(event.eventId);
    if (persisted) {
      combined.push(persisted);
      continue;
    }
    const barrier = barriers.get(event.nodeOriginId);
    if (barrier?.eventId === event.eventId) continue;
    if (!eventAllowedByBarrier(event, barrier, barrierRestorations.get(event.nodeOriginId))) {
      rejectedIncomingOrigins.add(event.nodeOriginId);
      continue;
    }
    const stamped = { ...event, commitRevision: Math.max(0, Math.floor(Number(nextRevision) || 0)) };
    newIncomingEventIds.add(stamped.eventId);
    combined.push(stamped);
    if (stamped.kind === "restore") barrierRestorations.set(stamped.nodeOriginId, stamped);
  }
  let journal = compactNodeMutationJournal(combined);
  const canCollect = (event) => Boolean(
    event &&
    Number.isSafeInteger(event.commitRevision) &&
    checkpoints.length > 0 &&
    checkpoints.every((checkpoint) => checkpoint.observedRevision >= event.commitRevision)
  );
  const origins = new Set(journal.map((event) => event.nodeOriginId));
  for (const origin of origins) {
    const deletion = journal.find((event) => event.nodeOriginId === origin && event.kind === "delete");
    const restoration = deletion && journal.find((event) => (
      event.nodeOriginId === origin && event.kind === "restore" && event.restoresEventId === deletion.eventId
    ));
    const boundary = restoration || deletion;
    if (!boundary || !canCollect(boundary)) continue;
    barriers.set(origin, {
      version: 1,
      nodeOriginId: origin,
      nodeId: boundary.nodeId,
      eventId: boundary.eventId,
      kind: restoration ? "restore" : "delete",
      commitRevision: boundary.commitRevision,
      createdAt: boundary.createdAt
    });
    journal = journal.filter((event) => event !== deletion && event !== restoration);
  }
  journal = journal.filter((event) => !syntheticBarrierEventIds.has(event.eventId));
  return {
    // A restore may intentionally stand alone after its delete was compacted
    // into a barrier. Re-compacting without that synthetic delete would drop
    // the causal restore before the next merge can rehydrate the boundary.
    journal: journal.sort((left, right) => laterNodeMutationEvent(left, right) ? 1 : laterNodeMutationEvent(right, left) ? -1 : 0),
    barriers: [...barriers.values()].sort((left, right) => left.nodeOriginId.localeCompare(right.nodeOriginId)),
    newIncomingEventIds,
    rejectedIncomingOrigins
  };
}

function normalizedAssetLocator(asset) {
  const value = cleanString(asset?.relativePath || asset?.path || asset?.assetUrl || asset?.url);
  if (!value || /^(?:data|blob):/i.test(value)) return "";
  return value.replace(/\\/g, "/").toLowerCase();
}

function generatedAssetKey(asset) {
  const importBatchId = cleanString(asset?.importBatchId);
  const importRootId = cleanString(asset?.importRootId);
  const sourceRelativePath = cleanString(asset?.sourceRelativePath);
  if (importBatchId && importRootId && sourceRelativePath) return "";
  const runId = cleanString(asset?.runId).toLowerCase();
  if (runId.startsWith("import-")) return "";
  const locator = normalizedAssetLocator(asset);
  // Imported assets intentionally use occurrence identity: selecting the same
  // file twice is a valid canvas operation. Generated files are idempotent by
  // their run and managed locator even if a stale renderer minted a new
  // occurrence while replaying the same result.
  if (!runId || !locator) return "";
  return `generated:${runId}:${locator}`;
}

function assetKey(asset, index) {
  const generatedKey = generatedAssetKey(asset);
  if (generatedKey) return generatedKey;
  const occurrenceId = cleanString(asset?.occurrenceId);
  if (occurrenceId) return `occurrence:${occurrenceId}`;
  const assetId = cleanString(asset?.assetId);
  if (assetId) return `asset:${assetId}`;
  const path = normalizedAssetLocator(asset);
  return path ? `path:${path}` : `slot:${index}:${cleanString(asset?.runId)}`;
}

function mergeAssets(existingAssets, incomingAssets) {
  const result = [];
  const indexByKey = new Map();
  for (const source of [Array.isArray(existingAssets) ? existingAssets : [], Array.isArray(incomingAssets) ? incomingAssets : []]) {
    source.forEach((asset, index) => {
      if (!asset || typeof asset !== "object") return;
      const key = assetKey(asset, index);
      const existingIndex = indexByKey.get(key);
      if (existingIndex === undefined) {
        indexByKey.set(key, result.length);
        result.push(clone(asset));
      } else {
        const previous = result[existingIndex];
        result[existingIndex] = {
          ...previous,
          ...clone(asset),
          ...(previous.occurrenceId ? { occurrenceId: previous.occurrenceId } : {}),
          ...(previous.assetId ? { assetId: previous.assetId } : {}),
          ...(previous.displayCode ? { displayCode: previous.displayCode } : {})
        };
      }
    });
  }
  return result.map((asset, index) => ({ ...asset, index: index + 1 }));
}

function nodeProgressScore(node) {
  const assets = Array.isArray(node?.assets) ? node.assets.length : 0;
  const completed = Math.max(0, Number(node?.imageProgress?.completed) || 0);
  const state = node?.imageState === "done" ? 4 : node?.imageState === "generating" ? 3 : node?.imageState === "error" ? 2 : 1;
  return assets * 1000 + completed * 10 + state;
}

function latestNodeFieldMutation(journal, origin, field) {
  let latest;
  for (const event of journal) {
    if (event.nodeOriginId !== origin || (event.kind !== "upsert" && event.kind !== "restore")) continue;
    const fields = nodeMutationFields(event);
    if (!fields.includes("*") && !fields.includes(field)) continue;
    if (!latest || laterNodeMutationEvent(event, latest)) latest = event;
  }
  return latest;
}

function mergeLogicalNode(existingNode, incomingNode, mutationState = {}) {
  const existing = clone(existingNode);
  const incoming = clone(incomingNode);
  const mergedAssets = mergeAssets(existing.assets, incoming.assets);
  const existingRicher = nodeProgressScore(existing) > nodeProgressScore(incoming);
  const richer = existingRicher ? existing : incoming;
  const merged = { ...existing, ...incoming };
  const origin = nodeOrigin(existing);
  for (const field of new Set([...Object.keys(existing), ...Object.keys(incoming)])) {
    const event = latestNodeFieldMutation(mutationState.journal || [], origin, field);
    if (!event || mutationState.newIncomingEventIds?.has(event.eventId)) continue;
    if (existing[field] === undefined) delete merged[field];
    else merged[field] = clone(existing[field]);
  }

  if (mergedAssets.length) {
    merged.assets = mergedAssets;
    merged.outputs = mergedAssets.length;
    merged.imageState = "done";
    merged.status = "done";
    merged.imageError = undefined;
  }

  if (existingRicher) {
    for (const key of [
      "prompt",
      "imageParams",
      "imageProgress",
      "imageCollection",
      "imageContainerSpec",
      "taskProvenance",
      "generationRunId"
    ]) {
      // Progress richness is only a legacy fallback. Once either writer has a
      // causal clock for this field, the clock above is authoritative.
      if (latestNodeFieldMutation(mutationState.journal || [], origin, key)) continue;
      if (richer[key] !== undefined) merged[key] = clone(richer[key]);
    }
  }

  const existingRequirementRevision = Number(existing.requirement?.revision) || 0;
  const incomingRequirementRevision = Number(incoming.requirement?.revision) || 0;
  if (existingRequirementRevision > incomingRequirementRevision) {
    merged.requirement = clone(existing.requirement);
    merged.prompt = existing.prompt;
    merged.title = existing.title;
  }

  merged.persistenceOriginId = cleanString(existing.persistenceOriginId || incoming.persistenceOriginId) || origin;
  return merged;
}

const singleNodeReferenceKeys = new Set([
  "nodeId",
  "parentId",
  "hostNodeId",
  "sourceNodeId",
  "sourceParentId",
  "ownerNodeId",
  "containerNodeId",
  "sourceContainerId",
  "requirementNodeId",
  "requirementSourceNodeId",
  "focusedNodeId",
  "targetNodeId",
  "forkFromNodeId",
  "selectedNodeId"
]);

const multipleNodeReferenceKeys = new Set([
  "nodeIds",
  "memberNodeIds",
  "childContainerNodeIds",
  "sourceNodeIds",
  "sourceContainerIds",
  "referenceContainerIds",
  "requirementInputNodeIds",
  "resultNodeIds",
  "lockedNodeIds"
]);

function remapNodeReferences(value, idMap, key = "") {
  if (typeof value === "string") {
    return singleNodeReferenceKeys.has(key) ? (idMap.get(value) || value) : value;
  }
  if (Array.isArray(value)) {
    if (multipleNodeReferenceKeys.has(key)) return value.map((item) => typeof item === "string" ? (idMap.get(item) || item) : remapNodeReferences(item, idMap));
    return value.map((item) => remapNodeReferences(item, idMap));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, remapNodeReferences(childValue, idMap, childKey)]));
}

function messageTime(message) {
  const parsed = Date.parse(cleanString(message?.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeMessages(existingMessages, incomingMessages) {
  const result = [];
  const indexById = new Map();
  for (const source of [Array.isArray(existingMessages) ? existingMessages : [], Array.isArray(incomingMessages) ? incomingMessages : []]) {
    source.forEach((message, index) => {
      if (!message || typeof message !== "object") return;
      const id = cleanString(message.id) || `legacy-message-${messageTime(message)}-${index}`;
      const resultIndex = indexById.get(id);
      if (resultIndex === undefined) {
        indexById.set(id, result.length);
        result.push(clone(message));
      } else {
        result[resultIndex] = { ...result[resultIndex], ...clone(message) };
      }
    });
  }
  return result;
}

function materializeConversations(session) {
  const conversations = Array.isArray(session?.conversations) ? clone(session.conversations) : [];
  const activeConversationId = cleanString(session?.activeConversationId);
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  if (!activeConversationId || !messages.length) return conversations;
  const index = conversations.findIndex((conversation) => cleanString(conversation?.id) === activeConversationId);
  const now = new Date().toISOString();
  const active = {
    id: activeConversationId,
    title: cleanString(conversations[index]?.title) || "当前会话",
    messages: clone(messages),
    createdAt: cleanString(conversations[index]?.createdAt) || now,
    updatedAt: cleanString(conversations[index]?.updatedAt) || now
  };
  if (index >= 0) conversations[index] = { ...conversations[index], ...active };
  else conversations.push(active);
  return conversations;
}

function mergeConversations(existingSession, incomingSession) {
  const result = [];
  const indexById = new Map();
  for (const source of [materializeConversations(existingSession), materializeConversations(incomingSession)]) {
    source.forEach((conversation, index) => {
      if (!conversation || typeof conversation !== "object") return;
      const id = cleanString(conversation.id) || `legacy-conversation-${index + 1}`;
      const resultIndex = indexById.get(id);
      if (resultIndex === undefined) {
        indexById.set(id, result.length);
        result.push({ ...clone(conversation), id });
      } else {
        const previous = result[resultIndex];
        result[resultIndex] = {
          ...previous,
          ...clone(conversation),
          id,
          createdAt: cleanString(previous.createdAt) || cleanString(conversation.createdAt),
          messages: mergeMessages(previous.messages, conversation.messages)
        };
      }
    });
  }
  return result;
}

function mergeLayoutGroups(existingGroups, incomingGroups) {
  const result = [];
  const indexById = new Map();
  for (const source of [Array.isArray(existingGroups) ? existingGroups : [], Array.isArray(incomingGroups) ? incomingGroups : []]) {
    source.forEach((group, index) => {
      if (!group || typeof group !== "object") return;
      const id = cleanString(group.id) || `legacy-layout-${index + 1}`;
      const existingIndex = indexById.get(id);
      if (existingIndex === undefined) {
        indexById.set(id, result.length);
        result.push({ ...clone(group), id });
      } else {
        result[existingIndex] = { ...result[existingIndex], ...clone(group), id };
      }
    });
  }
  return result;
}

function mergeProjectSessions(existingSession, incomingSession, options = {}) {
  const existing = existingSession && typeof existingSession === "object" ? clone(existingSession) : {};
  const incoming = incomingSession && typeof incomingSession === "object" ? clone(incomingSession) : {};
  const existingNodes = Array.isArray(existing.nodes) ? existing.nodes : [];
  const incomingNodes = Array.isArray(incoming.nodes) ? incoming.nodes : [];
  const usedIds = new Set(existingNodes.map((node) => cleanString(node?.id)).filter(Boolean));
  const existingById = new Map(existingNodes.map((node) => [cleanString(node?.id), node]).filter(([id]) => Boolean(id)));
  const existingByOrigin = new Map(existingNodes.map((node) => [nodeOrigin(node), node]).filter(([origin]) => Boolean(origin)));
  let nextSequence = Math.max(
    Number(existing.nodeSequence) || 0,
    Number(incoming.nodeSequence) || 0,
    ...existingNodes.flatMap((node) => [nodeSequenceFromCode(node?.id), nodeSequenceFromCode(node?.displayCode)]),
    ...incomingNodes.flatMap((node) => [nodeSequenceFromCode(node?.id), nodeSequenceFromCode(node?.displayCode)])
  );
  const idMap = new Map();

  for (const node of incomingNodes) {
    const id = cleanString(node?.id);
    if (!id) continue;
    const originMatch = existingByOrigin.get(nodeOrigin(node));
    const originMatchId = cleanString(originMatch?.id);
    if (originMatchId && originMatchId !== id) {
      idMap.set(id, originMatchId);
      continue;
    }
    const collision = existingById.get(id);
    if (!collision || sameLogicalNode(collision, node)) continue;
    let nextId = "";
    do {
      nextSequence += 1;
      nextId = nodeCodeForSequence(nextSequence);
    } while (usedIds.has(nextId));
    usedIds.add(nextId);
    idMap.set(id, nextId);
  }

  const remappedIncoming = remapNodeReferences(incoming, idMap);
  remappedIncoming.nodes = (Array.isArray(remappedIncoming.nodes) ? remappedIncoming.nodes : []).map((node) => {
    const originalId = cleanString(node?.id);
    const remappedId = idMap.get(originalId) || originalId;
    if (remappedId === originalId) return node;
    return { ...node, id: remappedId, displayCode: remappedId };
  });

  const requestedNow = options.now instanceof Date ? options.now.getTime() : Date.parse(cleanString(options.now));
  const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const checkpointOptions = {
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
    retentionMs: Math.max(0, Number(options.writerCheckpointRetentionMs) || DEFAULT_WRITER_CHECKPOINT_RETENTION_MS),
    incomingWriterId: cleanString(options.incomingWriterId)
  };
  const normalizedExistingJournal = normalizeNodeMutationJournal(existing.nodeMutationJournal);
  const normalizedIncomingJournal = normalizeNodeMutationJournal(remappedIncoming.nodeMutationJournal);
  const writerCheckpoints = mergeNodeMutationWriterCheckpoints(
    existing.nodeMutationWriterCheckpoints,
    remappedIncoming.nodeMutationWriterCheckpoints,
    { existing: normalizedExistingJournal, incoming: normalizedIncomingJournal },
    checkpointOptions
  );
  const mutationMerge = mergeNodeMutationJournals(
    normalizedExistingJournal,
    normalizedIncomingJournal,
    { existing: existing.nodeMutationBarriers, incoming: remappedIncoming.nodeMutationBarriers },
    writerCheckpoints,
    options.nextRevision
  );
  const tombstonedOrigins = new Set();
  for (const deletion of mutationMerge.journal.filter((event) => event.kind === "delete")) {
    const restored = mutationMerge.journal.some((event) => (
      event.kind === "restore" &&
      event.nodeOriginId === deletion.nodeOriginId &&
      event.restoresEventId === deletion.eventId
    ));
    if (!restored) tombstonedOrigins.add(deletion.nodeOriginId);
  }
  for (const barrier of mutationMerge.barriers) {
    const restored = mutationMerge.journal.some((event) => (
      event.kind === "restore" &&
      event.nodeOriginId === barrier.nodeOriginId &&
      event.restoresEventId === barrier.eventId
    ));
    if (barrier.kind === "delete" && !restored) tombstonedOrigins.add(barrier.nodeOriginId);
  }
  const existingByLogicalOrigin = new Map(existingNodes.map((node) => [nodeOrigin(node), node]));
  const incomingByLogicalOrigin = new Map(
    (Array.isArray(remappedIncoming.nodes) ? remappedIncoming.nodes : []).map((node) => [nodeOrigin(node), node])
  );
  const originOrder = [...new Set([...existingByLogicalOrigin.keys(), ...incomingByLogicalOrigin.keys()])];
  const mergedNodes = [];
  for (const origin of originOrder) {
    if (tombstonedOrigins.has(origin)) continue;
    const existingNode = existingByLogicalOrigin.get(origin);
    const incomingNode = incomingByLogicalOrigin.get(origin);
    if (mutationMerge.rejectedIncomingOrigins.has(origin)) {
      if (existingNode) mergedNodes.push(clone(existingNode));
      continue;
    }
    if (!existingNode && incomingNode) {
      mergedNodes.push(clone(incomingNode));
      continue;
    }
    if (existingNode && !incomingNode) {
      mergedNodes.push(clone(existingNode));
      continue;
    }
    if (!existingNode || !incomingNode) continue;
    mergedNodes.push(mergeLogicalNode(existingNode, incomingNode, mutationMerge));
  }

  const incomingOwnsNonNodeState = options.incomingOwnsNonNodeState === true;
  const conversations = incomingOwnsNonNodeState
    ? clone(Array.isArray(remappedIncoming.conversations) ? remappedIncoming.conversations : [])
    : mergeConversations(existing, remappedIncoming);
  const activeConversationId = cleanString(remappedIncoming.activeConversationId) || cleanString(existing.activeConversationId) || cleanString(conversations[0]?.id);
  const activeConversation = conversations.find((conversation) => cleanString(conversation?.id) === activeConversationId);
  const merged = {
    ...existing,
    ...remappedIncoming,
    schemaVersion: Math.max(5, Number(existing.schemaVersion) || 0, Number(remappedIncoming.schemaVersion) || 0),
    sessionRevision: Math.max(0, Math.floor(Number(options.nextRevision) || Number(existing.sessionRevision) || Number(remappedIncoming.sessionRevision) || 0)),
    canvasRevision: Math.max(0, Number(existing.canvasRevision) || 0, Number(remappedIncoming.canvasRevision) || 0),
    nodeSequence: Math.max(nextSequence, ...mergedNodes.flatMap((node) => [nodeSequenceFromCode(node?.id), nodeSequenceFromCode(node?.displayCode)])),
    nodes: mergedNodes,
    nodeMutationJournal: mutationMerge.journal,
    nodeMutationWriterCheckpoints: writerCheckpoints,
    nodeMutationBarriers: mutationMerge.barriers,
    layoutGroups: incomingOwnsNonNodeState
      ? clone(Array.isArray(remappedIncoming.layoutGroups) ? remappedIncoming.layoutGroups : [])
      : mergeLayoutGroups(existing.layoutGroups, remappedIncoming.layoutGroups),
    conversations,
    activeConversationId,
    messages: incomingOwnsNonNodeState
      ? clone(Array.isArray(remappedIncoming.messages) ? remappedIncoming.messages : [])
      : activeConversation ? clone(activeConversation.messages) : mergeMessages(existing.messages, remappedIncoming.messages),
    selectedNodeId: incomingOwnsNonNodeState
      ? cleanString(remappedIncoming.selectedNodeId)
      : cleanString(remappedIncoming.selectedNodeId) || cleanString(existing.selectedNodeId),
    pendingAgentExecution: incomingOwnsNonNodeState
      ? remappedIncoming.pendingAgentExecution ?? null
      : remappedIncoming.pendingAgentExecution ?? existing.pendingAgentExecution ?? null
  };
  return {
    session: merged,
    remappedNodeIds: Object.fromEntries(idMap),
    mergedConversationCount: conversations.length,
    nodeMutationJournal: mutationMerge.journal,
    nodeMutationWriterCheckpoints: writerCheckpoints,
    nodeMutationBarriers: mutationMerge.barriers
  };
}

module.exports = {
  collectNodeMutationEvents,
  compactNodeMutationJournal,
  mergeNodeMutationWriterCheckpoints,
  mergeProjectSessions,
  normalizeNodeMutationBarrier,
  normalizeNodeMutationBarriers,
  normalizeNodeMutationJournal,
  normalizeNodeMutationWriterCheckpoint,
  normalizeNodeMutationWriterCheckpoints,
  nodeCodeForSequence,
  nodeSequenceFromCode,
  prepareIncomingNodeMutationSession,
  updateNodeMutationWriterCheckpoint
};
