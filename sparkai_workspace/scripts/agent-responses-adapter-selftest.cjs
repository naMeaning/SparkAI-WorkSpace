"use strict";

const assert = require("node:assert/strict");
const {
  chatRequestFromRuntimeRequest,
  responsesInputFromChatMessages,
  responsesRequestFromChatRequest,
  responsesToolsFromChatTools
} = require("../desktop/agent-responses-adapter.cjs");

const imageUrl = "data:image/png;base64,AAAA";
const chatInput = {
  model: "gpt-6.1-sol", stream: true,
  messages: [
    { role: "system", content: "Keep existing system instructions" },
    { role: "responses_items", items: [
      { type: "reasoning", encrypted_content: "private-reasoning" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Reviewing" }] },
      { type: "function_call", call_id: "view-a", name: "view_image", arguments: "{}" },
      { type: "function_call", call_id: "view-b", name: "view_image", arguments: "{}" },
      { type: "function_call_output", call_id: "view-a", output: [{ type: "input_image", image_url: imageUrl, detail: "high" }] },
      { type: "function_call_output", call_id: "view-b", output: [{ type: "input_text", text: "read" }, { type: "input_image", image_url: imageUrl, detail: "original" }] }
    ] },
    { role: "user", content: [{ type: "input_text", text: "Continue" }, { type: "input_image", image_url: imageUrl }] }
  ]
};
const chat = chatRequestFromRuntimeRequest(chatInput);
assert.equal(chat.model, chatInput.model);
assert.equal(chat.stream, true);
assert.equal(chat.messages[0].role, "system");
assert.equal(chat.messages[1].tool_calls.length, 2);
assert.deepEqual(chat.messages.slice(2, 4).map((message) => message.tool_call_id), ["view-a", "view-b"]);
assert.ok(chat.messages.slice(2, 4).every((message) => typeof message.content === "string"));
assert.equal(chat.messages[4].role, "user", "Tool images must follow all paired tool outputs");
assert.deepEqual(chat.messages[4].content.slice(1).map((part) => part.image_url.detail), ["high", "original"]);
assert.equal(chat.messages[5].content[0].type, "text");
assert.equal(chat.messages[5].content[1].image_url.url, imageUrl);
assert.doesNotMatch(JSON.stringify(chat), /input_image|input_text|responses_items|private-reasoning/);
assert.equal(chatInput.messages[1].items[4].output[0].type, "input_image", "Adapter must not mutate runtime history");
assert.deepEqual(chatRequestFromRuntimeRequest(chat), chat, "A second pass must preserve the normalized request");
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
