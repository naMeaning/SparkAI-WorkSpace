"use strict";

const assert = require("node:assert/strict");
const {
  responsesInputFromChatMessages,
  responsesRequestFromChatRequest,
  responsesToolsFromChatTools
} = require("../desktop/agent-responses-adapter.cjs");

const imageUrl = "data:image/png;base64,AAAA";
const input = responsesInputFromChatMessages([
  { role: "system", content: "SYSTEM_TO_DEVELOPER" },
  {
    role: "user",
    content: [{ type: "image_url", image_url: { url: imageUrl, detail: "high" } }]
  },
  {
    role: "tool",
    tool_call_id: "view-1",
    content: [{ type: "input_image", image_url: imageUrl, detail: "original" }]
  }
]);

assert.deepEqual(input[0], { role: "developer", content: "SYSTEM_TO_DEVELOPER" });
assert.deepEqual(input[1], {
  role: "user",
  content: [{ type: "input_image", image_url: imageUrl, detail: "high" }]
});
assert.deepEqual(input[2], {
  type: "function_call_output",
  call_id: "view-1",
  output: [{ type: "input_image", image_url: imageUrl, detail: "original" }]
});

const tools = responsesToolsFromChatTools([
  {
    type: "function",
    function: {
      name: "view_image",
      description: "View a local image.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false
      },
      strict: true
    }
  },
  {
    type: "web_search",
    search_context_size: "high",
    filters: { allowed_domains: ["example.com"] },
    user_location: { type: "approximate", country: "CN" },
    external_web_access: true,
    indexed_web_access: false,
    search_content_types: ["text"],
    unexpected: "must-not-pass-through"
  }
]);

assert.equal(tools[0].type, "function");
assert.equal(tools[0].name, "view_image");
assert.equal(tools[0].strict, true);
assert.deepEqual(tools[1], {
  type: "web_search",
  search_context_size: "high",
  filters: { allowed_domains: ["example.com"] },
  user_location: { type: "approximate", country: "CN" },
  external_web_access: true,
  indexed_web_access: false,
  search_content_types: ["text"]
});

const withoutTools = responsesRequestFromChatRequest({
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "probe" }],
  tools: [],
  tool_choice: "required"
});

assert.equal(Object.hasOwn(withoutTools, "tools"), false);
assert.equal(Object.hasOwn(withoutTools, "tool_choice"), false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  systemRoleConverted: true,
  imageConverted: true,
  toolOutputConverted: true,
  functionStrictPreserved: true,
  webSearchAllowlistApplied: true,
  toolChoiceOmittedWithoutTools: true
})}\n`);
