import assert from "node:assert/strict";

import {
  emptyNodeSelection,
  nodeSelectionMode,
  normalizeNodeSelection,
  reduceNodeSelection,
  type NodeSelectionState,
} from "../src/selection-state.ts";

const available = new Set(["A", "B", "C", "D"]);

const frozen = <T>(value: T): T => {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child) => frozen(child));
  }
  return value;
};

const reduce = (state: NodeSelectionState, action: Parameters<typeof reduceNodeSelection>[1]) =>
  reduceNodeSelection(state, action, available);

const none = emptyNodeSelection();
assert.equal(nodeSelectionMode(none), "none");

const singleA = reduce(none, { type: "plain-click", id: "A" });
assert.deepEqual(singleA, { primaryId: "A", ids: ["A"] });
assert.equal(nodeSelectionMode(singleA), "single");

const singleB = reduce(singleA, { type: "plain-click", id: "B" });
assert.deepEqual(singleB, { primaryId: "B", ids: ["B"] }, "plain click must switch a single selection");

const multiple = reduce(singleA, { type: "toggle", id: "B" });
assert.deepEqual(multiple, { primaryId: "B", ids: ["A", "B"] });
assert.equal(nodeSelectionMode(multiple), "multiple");
assert.deepEqual(
  reduce(multiple, { type: "plain-click", id: "C" }),
  multiple,
  "plain click must preserve a multiple selection",
);

const toggledBack = reduce(multiple, { type: "toggle", id: "B" });
assert.deepEqual(toggledBack, { primaryId: "A", ids: ["A"] });
assert.equal(nodeSelectionMode(toggledBack), "single");

const marqueeIncludingA = reduce(singleA, { type: "replace-group", ids: ["A", "C"] });
assert.deepEqual(marqueeIncludingA, { primaryId: "A", ids: ["A", "C"] });

const marqueeReplacement = reduce(multiple, { type: "replace-group", ids: ["C", "D"] });
assert.deepEqual(marqueeReplacement, { primaryId: "C", ids: ["C", "D"] });

assert.deepEqual(
  reduce(multiple, { type: "replace-group", ids: [], preserveOnEmpty: true }),
  multiple,
  "an empty marquee must preserve the prior selection",
);

assert.deepEqual(
  reduce(multiple, { type: "focus", id: "A" }),
  { primaryId: "A", ids: ["A", "B"] },
  "programmatic focus may change the primary member without replacing the set",
);
assert.deepEqual(
  reduce(multiple, { type: "focus", id: "C" }),
  multiple,
  "programmatic focus outside a multiple selection must preserve the set",
);

assert.deepEqual(
  reduce(multiple, { type: "remove", ids: ["A"] }),
  { primaryId: "B", ids: ["B"] },
);
assert.deepEqual(reduce(singleA, { type: "remove", ids: ["A"] }), none);

assert.deepEqual(
  normalizeNodeSelection({ primaryId: "missing", ids: ["B", "B", "missing", "A"] }, available),
  { primaryId: "B", ids: ["B", "A"] },
);

const immutableInput = frozen<NodeSelectionState>({ primaryId: "A", ids: ["A", "B"] });
assert.deepEqual(reduce(immutableInput, { type: "toggle", id: "C" }), {
  primaryId: "C",
  ids: ["A", "B", "C"],
});

console.log(JSON.stringify({
  ok: true,
  modes: ["none", "single", "multiple"],
  cases: 16,
}));
