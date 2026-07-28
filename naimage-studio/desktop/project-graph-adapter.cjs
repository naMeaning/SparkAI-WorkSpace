"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { decode } = require("@msgpack/msgpack");

const PROJECT_GRAPH_SCHEMA_VERSION = 1;
const MAX_PROJECT_GRAPH_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PROJECT_GRAPH_STAGE_BYTES = 16 * 1024 * 1024;
const MAX_PROJECT_GRAPH_NODES = 1_000;
const MAX_PROJECT_GRAPH_EDGES = 3_000;
const MAX_PROJECT_GRAPH_TEXT_CHARS = 2_000;
const MAX_PROJECT_GRAPH_TRAVERSAL_DEPTH = 80;
const MAX_PROJECT_GRAPH_VISITED_OBJECTS = 100_000;

const ENTITY_CLASSES = new Set([
  "ConnectPoint",
  "ExtensionEntity",
  "ImageNode",
  "LatexNode",
  "PenStroke",
  "ReferenceBlockNode",
  "Section",
  "SvgNode",
  "TextNode",
  "UrlNode"
]);
const ASSOCIATION_CLASSES = new Set([
  "ArcEdge",
  "CubicCatmullRomSplineEdge",
  "LineEdge",
  "MultiTargetUndirectedEdge",
  "MutiTargetUndirectedEdge",
  "SyncAssociation"
]);

function projectGraphFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedText(value, fallback = "", maximum = MAX_PROJECT_GRAPH_TEXT_CHARS) {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const normalized = String(value).replace(/\u0000/g, "").trim();
  return normalized.slice(0, maximum) || fallback;
}

function safeIdentifier(value, fallback) {
  const normalized = boundedText(value, "", 180);
  return normalized || fallback;
}

function finiteCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Math.abs(numeric) <= 10_000_000 ? Math.round(numeric * 100) / 100 : undefined;
}

function nodeKindForClass(className) {
  if (className === "Section") return "section";
  if (className === "ImageNode" || className === "SvgNode") return "image";
  if (className === "UrlNode" || className === "ReferenceBlockNode") return "reference";
  if (className === "LatexNode") return "formula";
  if (className === "TextNode") return "concept";
  return "other";
}

function nodeLabelForObject(value, className, id) {
  const candidates = [value?.text, value?.title, value?.name, value?.label, value?.url];
  for (const candidate of candidates) {
    const label = boundedText(candidate);
    if (label) return label;
  }
  if (className === "ImageNode") return "图片概念";
  return `${className || "Concept"} ${id.slice(0, 8)}`;
}

function positionForObject(value) {
  const shape = value?.collisionBox?.shapes?.[0] || value?._collisionBoxNormal?.shapes?.[0];
  const location = shape?.location || value?.position || value?.location;
  const x = finiteCoordinate(location?.x);
  const y = finiteCoordinate(location?.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function getBySerializedPath(root, serializedPath) {
  if (typeof serializedPath !== "string" || !serializedPath.startsWith("/")) return undefined;
  const segments = serializedPath.split("/").slice(1);
  let current = root;
  for (const segment of segments) {
    if (!segment || segment === "__proto__" || segment === "prototype" || segment === "constructor") return undefined;
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function resolvedSerializedValue(root, value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.$ !== "string") return value;
  return getBySerializedPath(root, value.$);
}

function adaptSerializedStage(stage, options = {}) {
  if (!Array.isArray(stage)) throw projectGraphFailure("PROJECT_GRAPH_STAGE_INVALID", "Project Graph 舞台数据不是有效数组。");
  const title = boundedText(options.title, "Project Graph", 160);
  const warnings = [];
  const nodeById = new Map();
  const rawNodeById = new Map();
  const parentIdsByNode = new Map();
  const associations = [];
  const visited = new WeakSet();
  let visitedObjects = 0;

  function addNode(raw, className, parentId) {
    if (nodeById.size >= MAX_PROJECT_GRAPH_NODES) {
      if (!warnings.includes("节点数量超过安全上限，已只读取前 1000 个节点。")) warnings.push("节点数量超过安全上限，已只读取前 1000 个节点。");
      return "";
    }
    const fallbackId = `pg-node-${nodeById.size + 1}`;
    const id = safeIdentifier(raw?.uuid ?? raw?.id, fallbackId);
    if (!nodeById.has(id)) {
      const position = positionForObject(raw);
      nodeById.set(id, {
        id,
        label: nodeLabelForObject(raw, className, id),
        kind: nodeKindForClass(className),
        sourceClass: boundedText(className, "Unknown", 80),
        parentIds: [],
        ...(position ? { position } : {})
      });
      rawNodeById.set(id, raw);
    }
    if (parentId && parentId !== id) {
      const parents = parentIdsByNode.get(id) || new Set();
      parents.add(parentId);
      parentIdsByNode.set(id, parents);
    }
    return id;
  }

  function visit(value, parentId = "", depth = 0) {
    if (depth > MAX_PROJECT_GRAPH_TRAVERSAL_DEPTH) {
      if (!warnings.includes("图结构嵌套过深，已停止读取更深层节点。")) warnings.push("图结构嵌套过深，已停止读取更深层节点。");
      return;
    }
    const resolved = resolvedSerializedValue(stage, value);
    if (!resolved || typeof resolved !== "object") return;
    if (visited.has(resolved)) return;
    visited.add(resolved);
    visitedObjects += 1;
    if (visitedObjects > MAX_PROJECT_GRAPH_VISITED_OBJECTS) throw projectGraphFailure("PROJECT_GRAPH_STAGE_COMPLEX", "Project Graph 数据结构过于复杂。");

    if (Array.isArray(resolved)) {
      for (const item of resolved) visit(item, parentId, depth + 1);
      return;
    }

    const className = boundedText(resolved._ ?? resolved.type ?? resolved.kind, "", 100);
    if (ASSOCIATION_CLASSES.has(className) || Array.isArray(resolved.associationList)) {
      associations.push({ raw: resolved, className });
      return;
    }

    const entityLike = ENTITY_CLASSES.has(className) || Boolean(resolved.uuid && (resolved.text !== undefined || resolved.title !== undefined));
    let nextParentId = parentId;
    if (entityLike) {
      const nodeId = addNode(resolved, className || "Concept", parentId);
      if (className === "Section" && nodeId) nextParentId = nodeId;
    }

    if (Array.isArray(resolved.children)) {
      for (const child of resolved.children) visit(child, nextParentId, depth + 1);
    }
  }

  visit(stage);
  for (const [nodeId, parents] of parentIdsByNode) {
    const node = nodeById.get(nodeId);
    if (node) node.parentIds = [...parents].filter((parentId) => nodeById.has(parentId)).slice(0, 32);
  }

  const edges = [];
  const edgeKeys = new Set();
  function addEdge(raw, sourceId, targetId, directed, kind, suffix = "") {
    if (edges.length >= MAX_PROJECT_GRAPH_EDGES) {
      if (!warnings.includes("关系数量超过安全上限，已只读取前 3000 条关系。")) warnings.push("关系数量超过安全上限，已只读取前 3000 条关系。");
      return;
    }
    if (!nodeById.has(sourceId) || !nodeById.has(targetId) || sourceId === targetId) return;
    const key = `${sourceId}\u0000${targetId}\u0000${kind}\u0000${directed}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: safeIdentifier(raw?.uuid ?? raw?.id, `pg-edge-${edges.length + 1}`) + suffix,
      sourceId,
      targetId,
      label: boundedText(raw?.text ?? raw?.label, "", 500),
      directed,
      kind
    });
  }

  function entityId(value) {
    const resolved = resolvedSerializedValue(stage, value);
    if (typeof resolved === "string") return safeIdentifier(resolved, "");
    if (!resolved || typeof resolved !== "object") return "";
    return safeIdentifier(resolved.uuid ?? resolved.id, "");
  }

  for (const { raw, className } of associations) {
    const associatedIds = (Array.isArray(raw.associationList) ? raw.associationList : [])
      .map(entityId)
      .filter((id, index, list) => id && list.indexOf(id) === index);
    const directed = !/Undirected|SyncAssociation/i.test(className);
    const kind = className === "SyncAssociation" ? "sync" : directed ? "directed" : "association";
    if (associatedIds.length >= 2) {
      const sourceId = associatedIds[0];
      associatedIds.slice(1).forEach((targetId, index) => addEdge(raw, sourceId, targetId, directed, kind, associatedIds.length > 2 ? `-${index + 1}` : ""));
      continue;
    }
    const sourceId = entityId(raw.source ?? raw.sourceId ?? raw.from ?? raw._source);
    const targetId = entityId(raw.target ?? raw.targetId ?? raw.to ?? raw._target);
    if (sourceId && targetId) addEdge(raw, sourceId, targetId, directed, kind);
  }

  for (const node of nodeById.values()) {
    for (const parentId of node.parentIds) addEdge({ id: `contains-${parentId}-${node.id}`, text: "包含" }, parentId, node.id, true, "contains");
  }

  const incoming = new Set(edges.filter((edge) => edge.kind !== "contains" || edge.directed).map((edge) => edge.targetId));
  const nodes = [...nodeById.values()];
  const rootIds = nodes.filter((node) => node.parentIds.length === 0 && !incoming.has(node.id)).map((node) => node.id);
  if (!nodes.length) throw projectGraphFailure("PROJECT_GRAPH_EMPTY", "Project Graph 中没有找到可用于生成图片的概念节点。");

  return {
    schemaVersion: PROJECT_GRAPH_SCHEMA_VERSION,
    sourceFormat: options.sourceFormat || "project-graph-stage",
    sourceName: boundedText(options.sourceName, "project-graph.prg", 180),
    title,
    nodes,
    edges,
    rootIds: rootIds.length ? rootIds : nodes.slice(0, 1).map((node) => node.id),
    warnings,
    stats: { nodeCount: nodes.length, edgeCount: edges.length, sectionCount: nodes.filter((node) => node.kind === "section").length }
  };
}

function adaptGenericGraph(value, options = {}) {
  const sourceNodes = Array.isArray(value?.nodes) ? value.nodes : [];
  const sourceEdges = Array.isArray(value?.edges) ? value.edges : Array.isArray(value?.links) ? value.links : [];
  if (!sourceNodes.length) throw projectGraphFailure("PROJECT_GRAPH_EMPTY", "导入文件中没有找到概念节点。");
  const nodes = sourceNodes.slice(0, MAX_PROJECT_GRAPH_NODES).map((raw, index) => {
    const id = safeIdentifier(raw?.id ?? raw?.uuid, `pg-node-${index + 1}`);
    const position = positionForObject(raw);
    return {
      id,
      label: nodeLabelForObject(raw, boundedText(raw?.kind ?? raw?.type, "Concept", 80), id),
      kind: boundedText(raw?.kind, "concept", 40),
      sourceClass: boundedText(raw?.type ?? raw?.kind, "GenericNode", 80),
      parentIds: (Array.isArray(raw?.parentIds) ? raw.parentIds : raw?.parentId ? [raw.parentId] : []).map((item) => safeIdentifier(item, "")).filter(Boolean).slice(0, 32),
      ...(position ? { position } : {})
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = sourceEdges.slice(0, MAX_PROJECT_GRAPH_EDGES).flatMap((raw, index) => {
    const sourceId = safeIdentifier(raw?.sourceId ?? raw?.source ?? raw?.from, "");
    const targetId = safeIdentifier(raw?.targetId ?? raw?.target ?? raw?.to, "");
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId) || sourceId === targetId) return [];
    return [{
      id: safeIdentifier(raw?.id, `pg-edge-${index + 1}`),
      sourceId,
      targetId,
      label: boundedText(raw?.label ?? raw?.text, "", 500),
      directed: raw?.directed !== false,
      kind: boundedText(raw?.kind ?? raw?.type, "relation", 80)
    }];
  });
  const incoming = new Set(edges.map((edge) => edge.targetId));
  const rootIds = nodes.filter((node) => node.parentIds.length === 0 && !incoming.has(node.id)).map((node) => node.id);
  const warnings = [];
  if (sourceNodes.length > nodes.length) warnings.push("节点数量超过安全上限，已只读取前 1000 个节点。");
  if (sourceEdges.length > edges.length && sourceEdges.length > MAX_PROJECT_GRAPH_EDGES) warnings.push("关系数量超过安全上限，已只读取前 3000 条关系。");
  return {
    schemaVersion: PROJECT_GRAPH_SCHEMA_VERSION,
    sourceFormat: options.sourceFormat || "generic-graph-json",
    sourceName: boundedText(options.sourceName, "project-graph.json", 180),
    title: boundedText(value?.title ?? value?.name ?? options.title, "Project Graph", 160),
    nodes,
    edges,
    rootIds: rootIds.length ? rootIds : nodes.slice(0, 1).map((node) => node.id),
    warnings,
    stats: { nodeCount: nodes.length, edgeCount: edges.length, sectionCount: nodes.filter((node) => node.kind === "section").length }
  };
}

function findZipEntry(buffer, wantedName) {
  const minimumEocdOffset = Math.max(0, buffer.length - 65_557);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_INVALID", "Project Graph .prg 不是有效的 ZIP 容器。");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > 10_000 || centralDirectoryOffset + centralDirectorySize > buffer.length) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_INVALID", "Project Graph .prg 中央目录无效。");
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_INVALID", "Project Graph .prg 条目目录损坏。");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (nextOffset > buffer.length) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_INVALID", "Project Graph .prg 条目名称越界。");
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8").replace(/\\/g, "/");
    if (fileName === wantedName) {
      if (flags & 0x1) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_ENCRYPTED", "不支持加密的 Project Graph 文件。");
      if (![0, 8].includes(method)) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_COMPRESSION", "Project Graph 使用了不支持的压缩格式。");
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_ZIP64", "暂不支持 ZIP64 Project Graph 文件。");
      if (compressedSize > MAX_PROJECT_GRAPH_STAGE_BYTES || uncompressedSize > MAX_PROJECT_GRAPH_STAGE_BYTES) throw projectGraphFailure("PROJECT_GRAPH_STAGE_TOO_LARGE", "Project Graph 舞台数据超过 16 MiB 安全上限。");
      if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_INVALID", "Project Graph .prg 本地条目损坏。");
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset + compressedSize > buffer.length) throw projectGraphFailure("PROJECT_GRAPH_ARCHIVE_INVALID", "Project Graph 舞台数据越界。");
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const output = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_PROJECT_GRAPH_STAGE_BYTES });
      if (output.length > MAX_PROJECT_GRAPH_STAGE_BYTES || (uncompressedSize && output.length !== uncompressedSize)) throw projectGraphFailure("PROJECT_GRAPH_STAGE_INVALID", "Project Graph 舞台数据长度无效。");
      return output;
    }
    offset = nextOffset;
  }
  throw projectGraphFailure("PROJECT_GRAPH_STAGE_MISSING", "Project Graph .prg 中缺少 stage.msgpack。");
}

function decodeProjectGraphStage(bytes) {
  try {
    return decode(bytes, {
      maxStrLength: MAX_PROJECT_GRAPH_STAGE_BYTES,
      maxBinLength: MAX_PROJECT_GRAPH_STAGE_BYTES,
      maxArrayLength: MAX_PROJECT_GRAPH_VISITED_OBJECTS,
      maxMapLength: MAX_PROJECT_GRAPH_VISITED_OBJECTS
    });
  } catch (error) {
    throw projectGraphFailure("PROJECT_GRAPH_MSGPACK_INVALID", `Project Graph stage.msgpack 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseProjectGraphBuffer(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buffer.length) throw projectGraphFailure("PROJECT_GRAPH_FILE_EMPTY", "Project Graph 文件为空。");
  if (buffer.length > MAX_PROJECT_GRAPH_FILE_BYTES) throw projectGraphFailure("PROJECT_GRAPH_FILE_TOO_LARGE", "Project Graph 文件超过 64 MiB 安全上限。");
  const sourceName = boundedText(options.sourceName, "project-graph.prg", 180);
  const title = boundedText(options.title, path.basename(sourceName, path.extname(sourceName)), 160);
  const extension = path.extname(sourceName).toLowerCase();
  const looksLikeZip = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (extension === ".prg" || looksLikeZip) {
    const stageBytes = findZipEntry(buffer, "stage.msgpack");
    return adaptSerializedStage(decodeProjectGraphStage(stageBytes), { sourceName, title, sourceFormat: "project-graph-prg-v2" });
  }
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw projectGraphFailure("PROJECT_GRAPH_JSON_INVALID", "Project Graph JSON 文件无效。");
  }
  if (Array.isArray(parsed)) return adaptSerializedStage(parsed, { sourceName, title, sourceFormat: "project-graph-json-stage" });
  if (Array.isArray(parsed?.stage)) return adaptSerializedStage(parsed.stage, { sourceName, title: parsed.title || title, sourceFormat: "project-graph-json-stage" });
  return adaptGenericGraph(parsed, { sourceName, title, sourceFormat: "generic-graph-json" });
}

function parseProjectGraphFile(filePath) {
  const resolvedPath = path.resolve(String(filePath || ""));
  const extension = path.extname(resolvedPath).toLowerCase();
  if (![".prg", ".json"].includes(extension)) throw projectGraphFailure("PROJECT_GRAPH_FILE_TYPE", "请选择 .prg 或 .json 思维导图文件。");
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    throw projectGraphFailure("PROJECT_GRAPH_FILE_MISSING", "选择的 Project Graph 文件不存在或无法读取。");
  }
  if (!stat.isFile()) throw projectGraphFailure("PROJECT_GRAPH_FILE_TYPE", "选择的 Project Graph 路径不是文件。");
  if (stat.size > MAX_PROJECT_GRAPH_FILE_BYTES) throw projectGraphFailure("PROJECT_GRAPH_FILE_TOO_LARGE", "Project Graph 文件超过 64 MiB 安全上限。");
  return parseProjectGraphBuffer(fs.readFileSync(resolvedPath), { sourceName: path.basename(resolvedPath) });
}

module.exports = {
  MAX_PROJECT_GRAPH_EDGES,
  MAX_PROJECT_GRAPH_FILE_BYTES,
  MAX_PROJECT_GRAPH_NODES,
  MAX_PROJECT_GRAPH_STAGE_BYTES,
  PROJECT_GRAPH_SCHEMA_VERSION,
  adaptGenericGraph,
  adaptSerializedStage,
  findZipEntry,
  parseProjectGraphBuffer,
  parseProjectGraphFile,
  projectGraphFailure
};
