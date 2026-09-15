import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  agentFailureMessageToAppend,
  agentFailureVisibleLines,
  agentRunFailureCopy,
  filterAgentPickerModels,
  filterImagePickerModels,
  idleComposerPrimaryAction,
  runCompletedImageGen
} from "../src/model-ux.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const composerSource = readFileSync(join(root, "src", "project-agent-composer.tsx"), "utf8");
const mainSource = readFileSync(join(root, "src", "main.tsx"), "utf8");
const settingsSource = readFileSync(join(root, "src", "settings-drawer.tsx"), "utf8");
const agentSource = readFileSync(join(root, "src", "agent.ts"), "utf8");

assert.equal(
  idleComposerPrimaryAction({ executionBusy: false, goalSelected: false, canGenerate: true }),
  "generate",
  "Idle composer must treat generate-from-materials as the primary action"
);
assert.equal(
  idleComposerPrimaryAction({ executionBusy: false, goalSelected: true, canGenerate: true }),
  "send",
  "Goal confirmation must keep Agent send as the primary action"
);
assert.equal(
  idleComposerPrimaryAction({ executionBusy: true, canGenerate: true }),
  "send",
  "A running Agent must not promote generate over steer/send"
);
assert.equal(
  idleComposerPrimaryAction({ canGenerate: false }),
  "send",
  "Without a generate callback the composer may keep Agent send"
);

assert.match(composerSource, /data-primary-action=\{primaryAction\}/);
assert.match(composerSource, /idleComposerPrimaryAction\(/);
assert.match(
  composerSource,
  /className="project-agent-regenerate"[\s\S]{0,900}variant=\{primaryAction === "generate" \? "primary" : "secondary"\}[\s\S]{0,900}aria-label="生成"[\s\S]{0,500}>\s*生成\s*</
);
assert.match(
  composerSource,
  /className="project-agent-send"[\s\S]{0,900}variant=\{primaryAction === "send" \? "primary" : "secondary"\}[\s\S]{0,900}>\s*发送给 Agent\s*</
);
assert.match(composerSource, /filterImagePickerModels\(uniqueImageModels\(\[\.\.\.imageModels, \.\.\.selectedImageModels\]\)\)/);
assert.doesNotMatch(
  composerSource,
  /className="project-agent-send"[\s\S]{0,180}variant="primary"[\s\S]{0,220}className="project-agent-regenerate"/
);

const mixed = ["gpt-6-astra", "gpt-image-2", "claude-4.5-sonnet", "flux-1.1-pro", "doubao-seedance-2-0-260128"];
assert.deepEqual(filterImagePickerModels(mixed), ["gpt-image-2", "flux-1.1-pro"]);
assert.ok(!filterImagePickerModels(mixed).includes("gpt-6-astra"));
assert.ok(!filterAgentPickerModels(mixed).includes("gpt-image-2"));
assert.deepEqual(filterAgentPickerModels(mixed), ["gpt-6-astra", "claude-4.5-sonnet"]);
assert.match(settingsSource, /filterImagePickerModels\(/);
assert.match(settingsSource, /filterAgentPickerModels\(/);
assert.match(mainSource, /filterImagePickerModels\(imageModelsWithPreferredFallback/);
assert.match(mainSource, /filterAgentPickerModels\(modelsWithPreferred/);

assert.equal(runCompletedImageGen([
  { tool: "image_gen", phase: "tool-start" },
  { tool: "image_gen", phase: "tool-done" }
]), true);
assert.equal(runCompletedImageGen([{ tool: "view_image", phase: "tool-done" }]), false);

const afterImage = agentRunFailureCopy({
  imageGenCompleted: true,
  errorMessage: "Agent 调用失败：error code: 502"
});
assert.equal(afterImage.statusLine, "图片已生成。");
assert.match(afterImage.message, /图片已生成/);
assert.match(afterImage.message, /对话模型暂时不可用/);
assert.doesNotMatch(afterImage.message, /Agent 调用失败/);
assert.doesNotMatch(afterImage.statusLine, /Agent 失败/);

const visible = agentFailureVisibleLines({
  imageGenCompleted: true,
  errorMessage: "error code: 502"
});
assert.equal(visible.length, 2);
assert.notEqual(visible[0], visible[1]);
assert.equal(new Set(visible).size, 2);
assert.ok(visible.some((line) => line.includes("图片已生成")));
assert.ok(visible.some((line) => line.includes("对话模型")));
assert.ok(!visible.every((line) => /Agent 失败|Agent 调用失败/.test(line)));

const appendedAfterTimeline = agentFailureMessageToAppend({
  imageGenCompleted: true,
  errorMessage: "error code: 502",
  existingContents: ["图片已生成。"]
});
assert.equal(appendedAfterTimeline, "对话模型暂时不可用：error code: 502");
assert.notEqual(appendedAfterTimeline, "图片已生成。");
assert.equal(agentFailureMessageToAppend({
  imageGenCompleted: true,
  errorMessage: "error code: 502",
  existingContents: ["图片已生成。", "对话模型暂时不可用：error code: 502"]
}), "");

assert.match(agentSource, /agentRunFailureCopy\(\{[\s\S]{0,180}imageGenCompleted: Boolean\(options\?\.imageGenCompleted\)/);
assert.match(agentSource, /phase === "runtime-error" \|\| phase === "server-error"/);
assert.doesNotMatch(agentSource, /phase === "image-error" \|\| phase === "runtime-error" \|\| phase === "server-error"\) return `\$\{label\} 失败/);
assert.equal(agentRunFailureCopy({ imageGenCompleted: false, errorMessage: "502" }).statusLine, "对话模型调用失败。");
assert.notEqual(agentRunFailureCopy({ imageGenCompleted: false, errorMessage: "502" }).statusLine, "Agent 失败");

assert.match(mainSource, /agentFailureMessageToAppend\(/);
assert.match(mainSource, /runCompletedImageGen\(/);
assert.doesNotMatch(mainSource, /content: `Agent 调用失败：\$\{message\}`/);

console.log("model-ux selftest passed");
