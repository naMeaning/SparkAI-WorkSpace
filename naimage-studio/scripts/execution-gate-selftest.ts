import assert from "node:assert/strict";
import {
  agentExecutionScopeMatches,
  isAgentExecutionBusy,
  type AgentExecutionBusySnapshot,
  type AgentExecutionScopeSnapshot
} from "../src/core.ts";

const idle = (): AgentExecutionBusySnapshot => ({
  reservation: false,
  activeRun: false,
  activeImageRunCount: 0,
  status: "idle",
  pending: false
});

assert.equal(isAgentExecutionBusy(idle()), false, "An idle workspace must accept a new execution");

for (const [label, patch] of Object.entries<Partial<AgentExecutionBusySnapshot>>({
  reservation: { reservation: true },
  activeRun: { activeRun: true },
  imageRun: { activeImageRunCount: 1 },
  thinking: { status: "thinking" },
  editing: { status: "editing" },
  askUser: { pending: true }
})) {
  assert.equal(
    isAgentExecutionBusy({ ...idle(), ...patch }),
    true,
    `${label} must block every competing execution entrance`
  );
}

assert.equal(
  isAgentExecutionBusy({ ...idle(), status: "error" }),
  false,
  "A settled error must remain retryable"
);

let clickState = idle();
function reserveFromClick() {
  if (isAgentExecutionBusy(clickState)) return false;
  clickState = { ...clickState, reservation: true };
  return true;
}

assert.equal(reserveFromClick(), true, "The first click must reserve execution synchronously");
assert.equal(reserveFromClick(), false, "A consecutive click must be rejected by the same gate");
clickState = { ...clickState, reservation: false, activeRun: true, status: "thinking" };
assert.equal(reserveFromClick(), false, "Moving from reservation to an active run must not create an idle gap");
clickState = { ...idle(), pending: true };
assert.equal(reserveFromClick(), false, "AskUser suspension must keep the original execution boundary owned");
assert.equal(
  isAgentExecutionBusy({ ...clickState, pending: false }),
  false,
  "A pending-only turn may still be cancelled by an explicit conversation boundary action"
);

const frozen: AgentExecutionScopeSnapshot = {
  projectId: "project-a",
  conversationId: "conversation-a",
  taskSignature: "task-v1"
};

assert.equal(agentExecutionScopeMatches(frozen, { ...frozen }), true);
assert.equal(
  agentExecutionScopeMatches(frozen, { ...frozen, projectId: "project-b" }),
  false,
  "A project switch must invalidate a pending commit"
);
assert.equal(
  agentExecutionScopeMatches(frozen, { ...frozen, conversationId: "conversation-b" }),
  false,
  "A conversation switch must invalidate a pending commit"
);
assert.equal(
  agentExecutionScopeMatches(frozen, { ...frozen, taskSignature: "task-v2" }),
  false,
  "Changing the frozen task or target assets must invalidate a pending commit"
);

console.log("execution-gate-selftest: ok");
