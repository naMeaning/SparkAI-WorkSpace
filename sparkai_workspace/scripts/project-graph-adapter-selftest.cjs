"use strict";

const assert = require("node:assert/strict");
const { encode } = require("@msgpack/msgpack");
const {
  PROJECT_GRAPH_SCHEMA_VERSION,
  adaptGenericGraph,
  adaptSerializedStage,
  parseProjectGraphBuffer
} = require("../desktop/project-graph-adapter.cjs");

function storedZipEntry(name, data) {
  const fileName = Buffer.from(name, "utf8");
  const payload = Buffer.from(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + fileName.length + payload.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + fileName.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, fileName, payload, central, fileName, eocd]);
}

const stage = [
  {
    _: "Section",
    uuid: "section-learning",
    text: "光合作用",
    children: [
      { _: "TextNode", uuid: "concept-input", text: "阳光、水和二氧化碳" },
      { _: "TextNode", uuid: "concept-output", text: "葡萄糖和氧气" }
    ]
  },
  { $: "/0/children/0" },
  { $: "/0/children/1" },
  {
    _: "LineEdge",
    uuid: "edge-transform",
    text: "转化为",
    associationList: [{ $: "/0/children/0" }, { $: "/0/children/1" }]
  }
];

const adapted = adaptSerializedStage(stage, { sourceName: "biology.prg", title: "生物知识图" });
assert.equal(adapted.schemaVersion, PROJECT_GRAPH_SCHEMA_VERSION);
assert.equal(adapted.sourceName, "biology.prg");
assert.equal(adapted.stats.nodeCount, 3);
assert.equal(adapted.stats.sectionCount, 1);
assert.deepEqual(adapted.rootIds, ["section-learning"]);
assert.deepEqual(adapted.nodes.find((node) => node.id === "concept-input").parentIds, ["section-learning"]);
assert.ok(adapted.edges.some((edge) => edge.sourceId === "concept-input" && edge.targetId === "concept-output" && edge.label === "转化为"));
assert.equal(adapted.edges.filter((edge) => edge.kind === "contains").length, 2);

const prg = storedZipEntry("stage.msgpack", encode(stage));
const parsedPrg = parseProjectGraphBuffer(prg, { sourceName: "biology.prg" });
assert.equal(parsedPrg.sourceFormat, "project-graph-prg-v2");
assert.equal(parsedPrg.stats.nodeCount, 3);
assert.ok(!JSON.stringify(parsedPrg).includes("stage.msgpack"));

const generic = adaptGenericGraph({
  title: "记忆宫殿",
  nodes: [
    { id: "root", label: "太阳系" },
    { id: "earth", label: "地球", parentId: "root" },
    { id: "ignored", label: "无效关系仍保留节点" }
  ],
  edges: [
    { id: "orbit", source: "root", target: "earth", label: "包含", directed: true },
    { source: "missing", target: "earth", label: "无效" }
  ]
}, { sourceName: "memory.json" });
assert.equal(generic.title, "记忆宫殿");
assert.equal(generic.nodes.length, 3);
assert.equal(generic.edges.length, 1);
assert.equal(generic.edges[0].id, "orbit");

const parsedJson = parseProjectGraphBuffer(Buffer.from(JSON.stringify({ nodes: [{ id: "a", label: "A" }], edges: [] })), { sourceName: "simple.json" });
assert.equal(parsedJson.sourceFormat, "generic-graph-json");
assert.equal(parsedJson.rootIds[0], "a");

assert.throws(() => parseProjectGraphBuffer(Buffer.from("not-json"), { sourceName: "bad.json" }), /JSON 文件无效/);
assert.throws(() => parseProjectGraphBuffer(storedZipEntry("metadata.msgpack", encode({ version: "2" })), { sourceName: "missing.prg" }), /缺少 stage\.msgpack/);
assert.throws(() => adaptSerializedStage([], { title: "empty" }), /没有找到/);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 23, nodes: adapted.stats.nodeCount, edges: adapted.stats.edgeCount })}\n`);
