"use strict";

const {
  PORT_DATA_TYPES,
  isObject,
  isSlotId,
  isStepId,
  isEdgeId,
  isPortId,
  addError,
} = require("./sparkvas-contract-utils.cjs");

const RECIPE_NODE_TYPES = Object.freeze(["Input", "Brief", "Skill", "Transform", "Tool", "Review", "Output"]);
const SOURCE_NODE_TYPES = new Set(["Input", "Brief"]);
const EXECUTABLE_NODE_TYPES = new Set(["Skill", "Transform", "Tool", "Review"]);

function portsCompatible(fromType, toType) {
  return fromType === toType || fromType === "any" || toType === "any";
}

function portMap(node) {
  return {
    inputs: new Map((Array.isArray(node.inputPorts) ? node.inputPorts : [])
      .filter(port => isObject(port) && isPortId(port.portId)).map(port => [port.portId, port])),
    outputs: new Map((Array.isArray(node.outputPorts) ? node.outputPorts : [])
      .filter(port => isObject(port) && isPortId(port.portId)).map(port => [port.portId, port])),
  };
}

function indexRecipe(recipe, errors) {
  const nodes = new Map(), ports = new Map();
  const orderedIds = [];
  if (!isObject(recipe) || !Array.isArray(recipe.nodes) || recipe.nodes.length < 1 || recipe.nodes.length > 128) {
    addError(errors, "$.nodes", "RECIPE_NODES_INVALID", "Recipe requires 1-128 semantic nodes.");
    return { nodes, ports, orderedIds };
  }
  recipe.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`;
    if (!isObject(node) || !isStepId(node.stepId)) {
      addError(errors, path, "RECIPE_STEP_ID_INVALID", "Each recipe node requires a step.<slug> stepId.");
      return;
    }
    if (nodes.has(node.stepId)) {
      addError(errors, `${path}.stepId`, "RECIPE_STEP_DUPLICATE", "Recipe step IDs must be unique.");
      return;
    }
    if (!RECIPE_NODE_TYPES.includes(node.type)) {
      addError(errors, `${path}.type`, "RECIPE_NODE_TYPE_INVALID", "Recipe nodes must use one of Input, Brief, Skill, Transform, Tool, Review or Output.");
      return;
    }
    const inputPorts = Array.isArray(node.inputPorts) ? node.inputPorts : [];
    const outputPorts = Array.isArray(node.outputPorts) ? node.outputPorts : [];
    const seen = new Set();
    for (const [portIndex, port] of [...inputPorts, ...outputPorts].entries()) {
      if (!isObject(port) || !isPortId(port.portId) || !PORT_DATA_TYPES.includes(port.dataType)) {
        addError(errors, `${path}.ports[${portIndex}]`, "RECIPE_PORT_INVALID", "Ports require a lowercase portId and a supported dataType.");
        continue;
      }
      if (seen.has(port.portId)) addError(errors, `${path}.ports[${portIndex}]`, "RECIPE_PORT_DUPLICATE", "Port IDs must be unique within a node.");
      seen.add(port.portId);
    }
    if (node.type === "Input" && (inputPorts.length || outputPorts.length < 1)) {
      addError(errors, path, "RECIPE_INPUT_NODE_PORTS", "Input nodes have no inputs and at least one output.");
    }
    if (node.type === "Brief" && (inputPorts.length || outputPorts.length < 1)) {
      addError(errors, path, "RECIPE_BRIEF_NODE_PORTS", "Brief nodes have no inputs and at least one output.");
    }
    if (node.type === "Output" && (inputPorts.length < 1 || outputPorts.length)) {
      addError(errors, path, "RECIPE_OUTPUT_NODE_PORTS", "Output nodes have at least one input and no outputs.");
    }
    if (EXECUTABLE_NODE_TYPES.has(node.type) && (inputPorts.length < 1 || outputPorts.length < 1)) {
      addError(errors, path, "RECIPE_EXECUTABLE_NODE_PORTS", `${node.type} nodes require at least one input and one output.`);
    }
    nodes.set(node.stepId, node);
    ports.set(node.stepId, { inputs: portMap(node).inputs, outputs: portMap(node).outputs });
    orderedIds.push(node.stepId);
  });
  return { nodes, ports, orderedIds };
}

function validateSlotMappings(recipe, nodes, ports, errors) {
  if (!Array.isArray(recipe.inputSlots) || recipe.inputSlots.length < 1) {
    addError(errors, "$.inputSlots", "RECIPE_INPUT_SLOTS_INVALID", "Recipe requires at least one declared input slot.");
    return;
  }
  for (const [index, slot] of recipe.inputSlots.entries()) {
    const path = `$.inputSlots[${index}]`;
    if (!isObject(slot) || !isSlotId(slot.slotId) || !PORT_DATA_TYPES.includes(slot.dataType)) {
      addError(errors, path, "RECIPE_INPUT_SLOT_INVALID", "Input slots require slotId and dataType.");
      continue;
    }
    const matches = [...nodes.values()].filter(node => node.type === "Input" &&
      ports.get(node.stepId)?.outputs.has(slot.slotId));
    if (matches.length !== 1) {
      addError(errors, path, "RECIPE_INPUT_SLOT_UNMAPPED", "Each input slot must map to exactly one Input node output with the same portId.");
      continue;
    }
    const port = ports.get(matches[0].stepId).outputs.get(slot.slotId);
    if (port.dataType !== slot.dataType) {
      addError(errors, path, "RECIPE_INPUT_SLOT_TYPE_MISMATCH", "Input slot and Input node port data types must match.");
    }
  }
  const declaredInputs = new Set(recipe.inputSlots.filter(isObject).map(slot => slot.slotId));
  for (const node of nodes.values()) {
    if (node.type !== "Input") continue;
    for (const portId of ports.get(node.stepId).outputs.keys()) {
      if (!declaredInputs.has(portId)) {
        addError(errors, `$.nodes.${node.stepId}.outputPorts.${portId}`, "RECIPE_INPUT_PORT_UNDECLARED", "Input node ports must be declared by the recipe input slots.");
      }
    }
  }

  const outputs = recipe.outputContract?.outputs;
  if (!isObject(recipe.outputContract) || !Array.isArray(outputs) || outputs.length < 1) {
    addError(errors, "$.outputContract.outputs", "RECIPE_OUTPUT_CONTRACT_INVALID", "Recipe outputContract requires at least one output slot.");
    return;
  }
  for (const [index, slot] of outputs.entries()) {
    const path = `$.outputContract.outputs[${index}]`;
    if (!isObject(slot) || !isSlotId(slot.slotId) || !PORT_DATA_TYPES.includes(slot.dataType)) {
      addError(errors, path, "RECIPE_OUTPUT_SLOT_INVALID", "Output slots require slotId and dataType.");
      continue;
    }
    const matches = [...nodes.values()].filter(node => node.type === "Output" &&
      ports.get(node.stepId)?.inputs.has(slot.slotId));
    if (matches.length !== 1) {
      addError(errors, path, "RECIPE_OUTPUT_SLOT_UNMAPPED", "Each output slot must map to exactly one Output node input with the same portId.");
      continue;
    }
    const port = ports.get(matches[0].stepId).inputs.get(slot.slotId);
    if (port.dataType !== slot.dataType) {
      addError(errors, path, "RECIPE_OUTPUT_SLOT_TYPE_MISMATCH", "Output slot and Output node port data types must match.");
    }
  }
  const declaredOutputs = new Set(outputs.filter(isObject).map(slot => slot.slotId));
  for (const node of nodes.values()) {
    if (node.type !== "Output") continue;
    for (const portId of ports.get(node.stepId).inputs.keys()) {
      if (!declaredOutputs.has(portId)) {
        addError(errors, `$.nodes.${node.stepId}.inputPorts.${portId}`, "RECIPE_OUTPUT_PORT_UNDECLARED", "Output node ports must be declared by outputContract.");
      }
    }
  }
}

function validateEdges(recipe, nodes, ports, errors) {
  if (!Array.isArray(recipe.edges) || recipe.edges.length > 512) {
    addError(errors, "$.edges", "RECIPE_EDGES_INVALID", "Recipe edges must be an array with at most 512 items.");
    return new Map();
  }
  const incoming = new Map(), edgeIds = new Set(), endpoints = new Set();
  for (const [index, edge] of recipe.edges.entries()) {
    const path = `$.edges[${index}]`;
    if (!isObject(edge) || !isEdgeId(edge.edgeId)) {
      addError(errors, path, "RECIPE_EDGE_ID_INVALID", "Edges require an edge.<slug> edgeId.");
      continue;
    }
    if (edgeIds.has(edge.edgeId)) {
      addError(errors, `${path}.edgeId`, "RECIPE_EDGE_DUPLICATE", "Edge IDs must be unique.");
      continue;
    }
    edgeIds.add(edge.edgeId);
    const fromNode = nodes.get(edge.fromStepId), toNode = nodes.get(edge.toStepId);
    if (!fromNode || !toNode) {
      addError(errors, path, "RECIPE_EDGE_STEP_MISSING", "Edge endpoints must reference existing steps.");
      continue;
    }
    if (edge.fromStepId === edge.toStepId) {
      addError(errors, path, "RECIPE_EDGE_SELF", "A recipe step cannot connect to itself.");
      continue;
    }
    const fromPort = ports.get(edge.fromStepId)?.outputs.get(edge.fromPortId);
    const toPort = ports.get(edge.toStepId)?.inputs.get(edge.toPortId);
    if (!fromPort || !toPort) {
      addError(errors, path, "RECIPE_EDGE_PORT_MISSING", "Edge endpoints must reference existing output and input ports.");
      continue;
    }
    if (!portsCompatible(fromPort.dataType, toPort.dataType)) {
      addError(errors, path, "RECIPE_EDGE_TYPE_MISMATCH", "Connected ports must use compatible data types.");
      continue;
    }
    const endpoint = `${edge.fromStepId}.${edge.fromPortId}->${edge.toStepId}.${edge.toPortId}`;
    if (endpoints.has(endpoint)) {
      addError(errors, path, "RECIPE_EDGE_ENDPOINT_DUPLICATE", "Duplicate edge endpoints are not allowed.");
      continue;
    }
    endpoints.add(endpoint);
    const key = `${edge.toStepId}.${edge.toPortId}`;
    incoming.set(key, (incoming.get(key) || 0) + 1);
    if (incoming.get(key) > 1) addError(errors, path, "RECIPE_EDGE_FAN_IN", "An input port accepts only one incoming edge in v1.");
  }
  return incoming;
}

function topologicalRecipeSteps(recipe, indexed) {
  const index = indexed || indexRecipe(recipe, []);
  if (!index.nodes.size) return undefined;
  const { nodes, orderedIds } = index;
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const indegree = new Map(orderedIds.map(id => [id, 0]));
  const adjacency = new Map(orderedIds.map(id => [id, []]));
  for (const edge of Array.isArray(recipe.edges) ? recipe.edges : []) {
    if (!nodes.has(edge?.fromStepId) || !nodes.has(edge?.toStepId) || edge.fromStepId === edge.toStepId) continue;
    adjacency.get(edge.fromStepId).push(edge.toStepId);
    indegree.set(edge.toStepId, (indegree.get(edge.toStepId) || 0) + 1);
  }
  const ready = orderedIds.filter(id => indegree.get(id) === 0);
  const result = [];
  while (ready.length) {
    ready.sort((left, right) => orderIndex.get(left) - orderIndex.get(right));
    const id = ready.shift();
    result.push(id);
    for (const target of adjacency.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) ready.push(target);
    }
  }
  return result.length === orderedIds.length ? result : undefined;
}

function requiredPortConnections(recipe, nodes, ports, incoming, errors) {
  for (const node of nodes.values()) {
    for (const [portId, port] of ports.get(node.stepId).inputs) {
      if (port.required !== false && !incoming.get(`${node.stepId}.${portId}`)) {
        addError(errors, `$.nodes.${node.stepId}.inputPorts.${portId}`, "RECIPE_REQUIRED_PORT_UNCONNECTED", "Every required input port must be connected before execution.");
      }
    }
  }
}

function reachableNodes(nodes, adjacency, roots) {
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    for (const target of adjacency.get(id) || []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

function requireExecutablePaths(nodes, edges, errors) {
  const forward = new Map([...nodes.keys()].map(id => [id, []]));
  const backward = new Map([...nodes.keys()].map(id => [id, []]));
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!nodes.has(edge?.fromStepId) || !nodes.has(edge?.toStepId)) continue;
    forward.get(edge.fromStepId).push(edge.toStepId);
    backward.get(edge.toStepId).push(edge.fromStepId);
  }
  const sources = [...nodes.values()].filter(node => SOURCE_NODE_TYPES.has(node.type)).map(node => node.stepId);
  const outputs = [...nodes.values()].filter(node => node.type === "Output").map(node => node.stepId);
  const fromSources = reachableNodes(nodes, forward, sources);
  const toOutputs = reachableNodes(nodes, backward, outputs);
  for (const stepId of nodes.keys()) {
    if (!fromSources.has(stepId)) addError(errors, `$.nodes.${stepId}`, "RECIPE_NODE_UNREACHABLE", "Every step must be reachable from an Input or Brief.");
    if (!toOutputs.has(stepId)) addError(errors, `$.nodes.${stepId}`, "RECIPE_NODE_DOES_NOT_REACH_OUTPUT", "Every step must lead to an Output.");
  }
}

function validateRecipeGraph(recipe, { requireComplete = true } = {}) {
  const errors = [];
  const indexed = indexRecipe(recipe, errors);
  const { nodes, ports } = indexed;
  if (!nodes.size) return { ok: false, errors, order: undefined };
  const inputNodes = [...nodes.values()].filter(node => node.type === "Input");
  const outputNodes = [...nodes.values()].filter(node => node.type === "Output");
  if (!inputNodes.length) addError(errors, "$.nodes", "RECIPE_INPUT_NODE_MISSING", "Recipe requires at least one Input node.");
  if (!outputNodes.length) addError(errors, "$.nodes", "RECIPE_OUTPUT_NODE_MISSING", "Recipe requires at least one Output node.");
  validateSlotMappings(recipe, nodes, ports, errors);
  const incoming = validateEdges(recipe, nodes, ports, errors);
  const order = topologicalRecipeSteps(recipe, indexed);
  if (!order) addError(errors, "$.edges", "RECIPE_GRAPH_CYCLE", "Recipe graph must be acyclic.");
  if (requireComplete) {
    requiredPortConnections(recipe, nodes, ports, incoming, errors);
    requireExecutablePaths(nodes, recipe.edges, errors);
  }
  return { ok: errors.length === 0, errors, order };
}

module.exports = {
  RECIPE_NODE_TYPES,
  portsCompatible,
  validateRecipeGraph,
  topologicalRecipeSteps,
};
