import assert from "node:assert/strict";

import {
  agentPanelLayoutForPlacement,
  agentPanelLayoutFromPointer,
  agentPanelLayoutFromSettings,
  clampAgentPanelLayout,
  type AgentPanelLayout
} from "../src/agent-panel-layout.ts";
import { defaultSettings } from "../src/settings-persistence.ts";

const bounds = { width: 1_200, height: 900 };
const right: AgentPanelLayout = {
  agentPanelPlacement: "right",
  agentPanelWidth: 390,
  agentPanelHeight: 680,
  agentPanelX: 56,
  agentPanelY: 56
};

assert.deepEqual(agentPanelLayoutFromSettings(defaultSettings), right);
assert.equal(agentPanelLayoutFromPointer(right, "resize-dock", -80, 0, bounds).agentPanelWidth, 470);
assert.equal(agentPanelLayoutFromPointer(right, "resize-dock", 100, 0, bounds).agentPanelWidth, 320);

const left = { ...right, agentPanelPlacement: "left" as const };
assert.equal(agentPanelLayoutFromPointer(left, "resize-dock", 80, 0, bounds).agentPanelWidth, 470);

const top = { ...right, agentPanelPlacement: "top" as const, agentPanelHeight: 500 };
assert.equal(agentPanelLayoutFromPointer(top, "resize-dock", 0, 100, bounds).agentPanelHeight, 600);
assert.equal(agentPanelLayoutFromPointer(top, "resize-dock", 0, 900, bounds).agentPanelHeight, 740);

const bottom = { ...right, agentPanelPlacement: "bottom" as const, agentPanelHeight: 600 };
assert.equal(agentPanelLayoutFromPointer(bottom, "resize-dock", 0, 100, bounds).agentPanelHeight, 500);
assert.equal(agentPanelLayoutFromPointer(bottom, "resize-dock", 0, 900, bounds).agentPanelHeight, 420);

const floating = { ...right, agentPanelPlacement: "floating" as const, agentPanelWidth: 400, agentPanelHeight: 500, agentPanelX: 56, agentPanelY: 56 };
const moved = agentPanelLayoutFromPointer(floating, "move", 2_000, 2_000, bounds);
assert.equal(moved.agentPanelX, 792);
assert.equal(moved.agentPanelY, 392);
assert.equal(agentPanelLayoutFromPointer(floating, "resize-corner", 120, 80, bounds).agentPanelWidth, 520);
assert.equal(agentPanelLayoutFromPointer(floating, "resize-corner", 120, 80, bounds).agentPanelHeight, 580);

const placedTop = agentPanelLayoutForPlacement(right, "top", bounds);
assert.equal(placedTop.agentPanelPlacement, "top");
assert.equal(placedTop.agentPanelHeight, 420);
assert.equal(agentPanelLayoutForPlacement(right, "bottom", { width: 1_200, height: 1_200 }).agentPanelHeight, 504);
assert.equal(agentPanelLayoutForPlacement(right, "floating", bounds).agentPanelHeight, 680);

const clampedTop = clampAgentPanelLayout({ ...top, agentPanelHeight: 1_400 }, { width: 1_200, height: 800 });
assert.equal(clampedTop.agentPanelHeight, 640);
assert.equal(clampAgentPanelLayout({ ...right, agentPanelWidth: 2_000 }, { width: 800, height: 900 }).agentPanelWidth, 640);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 16 })}\n`);
