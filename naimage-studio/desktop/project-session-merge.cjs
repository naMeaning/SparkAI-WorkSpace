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

function assetKey(asset, index) {
  const occurrenceId = cleanString(asset?.occurrenceId);
  if (occurrenceId) return `occurrence:${occurrenceId}`;
  const assetId = cleanString(asset?.assetId);
  if (assetId) return `asset:${assetId}`;
  const path = cleanString(asset?.path || asset?.relativePath || asset?.assetUrl || asset?.url);
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
        result[existingIndex] = { ...result[existingIndex], ...clone(asset) };
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

function mergeLogicalNode(existingNode, incomingNode) {
  const existing = clone(existingNode);
  const incoming = clone(incomingNode);
  const mergedAssets = mergeAssets(existing.assets, incoming.assets);
  const existingRicher = nodeProgressScore(existing) > nodeProgressScore(incoming);
  const richer = existingRicher ? existing : incoming;
  const merged = { ...existing, ...incoming };

  if (mergedAssets.length) {
    merged.assets = mergedAssets;
    merged.outputs = Math.max(Number(existing.outputs) || 0, Number(incoming.outputs) || 0, mergedAssets.length);
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

  merged.persistenceOriginId = cleanString(existing.persistenceOriginId || incoming.persistenceOriginId) || nodeOrigin(existing);
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

  const mergedNodes = existingNodes.map((node) => clone(node));
  const mergedIndexById = new Map(mergedNodes.map((node, index) => [cleanString(node?.id), index]));
  for (const node of remappedIncoming.nodes) {
    const id = cleanString(node?.id);
    if (!id) continue;
    const index = mergedIndexById.get(id);
    if (index === undefined) {
      mergedIndexById.set(id, mergedNodes.length);
      mergedNodes.push(clone(node));
    } else if (sameLogicalNode(mergedNodes[index], node)) {
      mergedNodes[index] = mergeLogicalNode(mergedNodes[index], node);
    }
  }

  const conversations = mergeConversations(existing, remappedIncoming);
  const activeConversationId = cleanString(remappedIncoming.activeConversationId) || cleanString(existing.activeConversationId) || cleanString(conversations[0]?.id);
  const activeConversation = conversations.find((conversation) => cleanString(conversation?.id) === activeConversationId);
  const merged = {
    ...existing,
    ...remappedIncoming,
    schemaVersion: Math.max(3, Number(existing.schemaVersion) || 0, Number(remappedIncoming.schemaVersion) || 0),
    sessionRevision: Math.max(0, Math.floor(Number(options.nextRevision) || Number(existing.sessionRevision) || Number(remappedIncoming.sessionRevision) || 0)),
    canvasRevision: Math.max(0, Number(existing.canvasRevision) || 0, Number(remappedIncoming.canvasRevision) || 0),
    nodeSequence: Math.max(nextSequence, ...mergedNodes.flatMap((node) => [nodeSequenceFromCode(node?.id), nodeSequenceFromCode(node?.displayCode)])),
    nodes: mergedNodes,
    layoutGroups: mergeLayoutGroups(existing.layoutGroups, remappedIncoming.layoutGroups),
    conversations,
    activeConversationId,
    messages: activeConversation ? clone(activeConversation.messages) : mergeMessages(existing.messages, remappedIncoming.messages),
    selectedNodeId: cleanString(remappedIncoming.selectedNodeId) || cleanString(existing.selectedNodeId),
    pendingAgentExecution: remappedIncoming.pendingAgentExecution ?? existing.pendingAgentExecution ?? null
  };
  return { session: merged, remappedNodeIds: Object.fromEntries(idMap), mergedConversationCount: conversations.length };
}

module.exports = {
  mergeProjectSessions,
  nodeCodeForSequence,
  nodeSequenceFromCode
};
