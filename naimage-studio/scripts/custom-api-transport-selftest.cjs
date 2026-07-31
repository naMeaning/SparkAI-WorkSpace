"use strict";

const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createNewApiClient } = require("../desktop/new-api-client.cjs");

function response({ contentType, data, status = 200 }) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? contentType : null },
    body: contentType.includes("text/event-stream") ? Readable.from([Buffer.from(text)]) : undefined,
    async text() { return text; }
  };
}

async function main() {
  let transport = async () => response({ contentType: "application/json", data: {} });
  let captured = null;
  const resolvedAccountTokenIds = [];
  const client = createNewApiClient({
    defaultSettings: {
      accountBaseUrl: "https://sparkapi.org",
      relayBaseUrl: "",
      updateBaseUrl: "https://sparkapi.org"
    },
    ensureLocalServer: async () => {},
    isLocalServerUrl: () => false,
    migrateSettings: (settings) => ({ ...settings }),
    newApiTransportFetch: async (url, options) => {
      captured = { url, options };
      return await transport(url, options);
    },
    normalizeServerUrl(value, fallback = "") {
      return String(value || fallback || "").trim().replace(/\/+$/, "");
    },
    readJson: () => ({}),
    resolveAccountApiCredentials: async (_settings, tokenId) => {
      resolvedAccountTokenIds.push(tokenId);
      return {
        baseUrl: "https://sparkapi.org/v1",
        apiKey: tokenId ? `account-key-${tokenId}` : "account-key",
        tokenId: tokenId || "7",
        group: "vision"
      };
    },
    settingsPath: "memory://settings.json",
    writeJson: () => {}
  });
  const settings = {
    accessMode: "custom",
    agentBaseUrl: "https://gateway.example/v1/",
    agentApiKey: "agent-key",
    imageBaseUrl: "https://images.example",
    imageApiKey: "image-key",
    imageModelBindings: [
      { model: "gpt-image-2", customApiKey: "bound-image-key", accountTokenId: "12" },
      { model: "grok-image-1", customApiKey: "grok-bound-key" },
      { model: "gpt-5.6-sol", customApiKey: "must-not-use-responses-model-binding" }
    ],
    modelGroup: "must-not-leak"
  };

  assert.equal(client.customApiUrl(settings, "/v1/responses"), "https://gateway.example/v1/responses");
  assert.equal(client.customApiUrl(settings, "v1/chat/completions"), "https://gateway.example/v1/chat/completions");
  assert.equal(client.customApiUrl(settings, "/v1/images/generations", "image"), "https://images.example/v1/images/generations");
  assert.equal(client.customApiUrl({ ...settings, imageApiKey: "" }, "/v1/images/generations", "image", "grok-image-1"), "https://images.example/v1/images/generations");
  assert.equal(client.customApiHeaders({ ...settings, imageApiKey: "" }, "image", "grok-image-1").authorization, "Bearer grok-bound-key");

  transport = async () => response({
    contentType: "application/json; charset=utf-8",
    data: { data: [{ b64_json: "aW1hZ2UtZml4dHVyZQ==" }] }
  });
  const imageBody = {
    model: "gpt-image-2",
    prompt: "真实提示词必须随 JSON 请求发送",
    size: "1024x1024",
    quality: "high",
    n: 1,
    group: "must-not-leak"
  };
  await client.newApiRelayJson(settings, "/v1/images/generations", imageBody, { provider: "image" });
  assert.equal(captured.url, "https://images.example/v1/images/generations");
  assert.equal(captured.options.headers.authorization, "Bearer bound-image-key");
  const forwardedImageBody = JSON.parse(captured.options.body);
  assert.equal(Object.hasOwn(forwardedImageBody, "group"), false);
  assert.equal(forwardedImageBody.model, imageBody.model);
  assert.equal(forwardedImageBody.prompt, imageBody.prompt);
  assert.equal(forwardedImageBody.size, "1024x1024");
  assert.equal(forwardedImageBody.quality, "high");
  assert.equal(forwardedImageBody.n, 1);

  await client.newApiRelayJson({ ...settings, imageApiKey: "" }, "/v1/images/generations", { ...imageBody, model: "grok-image-1" }, { provider: "image" });
  assert.equal(captured.url, "https://images.example/v1/images/generations", "All image bindings must share the configured image Base URL");
  assert.equal(captured.options.headers.authorization, "Bearer grok-bound-key");

  if (typeof FormData !== "undefined") {
    const editBody = new FormData();
    editBody.set("model", "grok-image-1");
    editBody.set("prompt", "form data model binding");
    await client.newApiRelayImage({ ...settings, imageApiKey: "" }, "/v1/images/edits", editBody, () => {});
    assert.equal(captured.options.headers.authorization, "Bearer grok-bound-key", "FormData image requests must resolve the binding from the model field");
  }

  await client.newApiRelayJson(settings, "/v1/images/generations", { ...imageBody, model: "flux-unbound" }, { provider: "image" });
  assert.equal(captured.options.headers.authorization, "Bearer image-key", "Unbound image models must fall back to the global image API key");

  const accountSettings = {
    ...settings,
    accessMode: "account",
    accountBaseUrl: "https://sparkapi.org",
    serverSessionCookie: "session=fixture",
    serverUserId: "42",
    selectedAccountTokenId: "7",
    selectedAccountTokenGroup: "vision"
  };
  await client.newApiRelayJson(accountSettings, "/v1/images/generations", imageBody, { provider: "image" });
  assert.equal(resolvedAccountTokenIds.at(-1), "12");
  assert.equal(captured.options.headers.authorization, "Bearer account-key-12");

  transport = async () => response({
    contentType: "application/json; charset=utf-8",
    data: { type: "response.completed", response: { output_text: "fixture response" } }
  });
  const jsonEvents = [];
  await client.newApiRelayStream(settings, "/v1/responses", { model: "gpt-fixture", group: "must-not-leak" }, (event) => jsonEvents.push(event));
  assert.equal(captured.url, "https://gateway.example/v1/responses");
  assert.equal(captured.options.headers.authorization, "Bearer agent-key");
  assert.equal(JSON.parse(captured.options.body).group, undefined);
  assert.equal(jsonEvents[0].response.output_text, "fixture response");

  transport = async () => response({ contentType: "application/json", data: {} });
  await assert.rejects(
    () => client.newApiRelayStream(settings, "/v1/responses", { model: "gpt-fixture" }, () => {}),
    (error) => error?.code === "NEW_API_EMPTY_STREAM_OUTPUT"
  );

  transport = async () => response({ contentType: "text/event-stream; charset=utf-8", data: "data: [DONE]\n\n" });
  await assert.rejects(
    () => client.newApiRelayStream(settings, "/v1/responses", { model: "gpt-fixture" }, () => {}),
    (error) => error?.code === "NEW_API_EMPTY_STREAM_OUTPUT"
  );

  transport = async () => response({
    contentType: "text/event-stream; charset=utf-8",
    data: "data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"stream fixture\"}}\n\n"
  });
  const streamEvents = [];
  await client.newApiRelayStream(settings, "/v1/responses", { model: "gpt-fixture" }, (event) => streamEvents.push(event));
  assert.equal(streamEvents.length, 1);
  assert.equal(streamEvents[0].response.output_text, "stream fixture");

  transport = async () => response({
    contentType: "text/event-stream; charset=utf-8",
    data: [
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cHJldmlldy0x"}\n\n',
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":1,"partial_image_b64":"cHJldmlldy0y"}\n\n',
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":2,"partial_image_b64":"cHJldmlldy0z"}\n\n',
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":3,"partial_image_b64":"ZmluYWwtbGlrZS1wYXJ0aWFs"}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"ZmluYWwtaW1hZ2U=","revised_prompt":"fixture revised"}}\n\n',
      'data: {"type":"response.completed","response":{"created_at":123,"output":[{"type":"image_generation_call","result":"ZmluYWwtaW1hZ2U=","revised_prompt":"fixture revised"}],"usage":{"total_tokens":9}}}\n\n'
    ].join("")
  });
  const responsePartials = [];
  const responsesImage = await client.newApiRelayResponsesImage(settings, {
    model: "gpt-5.6-sol",
    input: "真实 Responses 生图提示词",
    tools: [{ type: "image_generation", action: "generate", size: "1024x1024", output_format: "png" }],
    tool_choice: "required",
    group: "must-not-leak"
  }, (partial) => responsePartials.push(partial), {
    headers: { "Idempotency-Key": "responses-image-fixture" },
    partialImages: 3
  });
  assert.equal(captured.url, "https://images.example/v1/responses");
  assert.equal(captured.options.headers.authorization, "Bearer image-key");
  assert.equal(captured.options.headers["Idempotency-Key"], "responses-image-fixture");
  const forwardedResponsesBody = JSON.parse(captured.options.body);
  assert.equal(forwardedResponsesBody.group, undefined);
  assert.equal(forwardedResponsesBody.input, "真实 Responses 生图提示词");
  assert.equal(forwardedResponsesBody.stream, true);
  assert.equal(forwardedResponsesBody.tools[0].partial_images, 3);
  assert.deepEqual(responsePartials.map((item) => item.index), [1, 2, 3]);
  assert(responsePartials.every((item) => item.total === 3));
  assert.equal(responsesImage.data.length, 1, "output_item.done and response.completed finals must be deduplicated");
  assert.equal(responsesImage.data[0].b64_json, "ZmluYWwtaW1hZ2U=");
  assert.equal(responsesImage.data[0].revised_prompt, "fixture revised");
  assert.equal(responsesImage.created, 123);
  assert.equal(responsesImage.partial_images, 3);

  const accountResponsesImage = await client.newApiRelayResponsesImage(accountSettings, {
    model: "gpt-5.6-sol",
    input: "account responses image",
    tools: [{ type: "image_generation", action: "generate" }],
    group: "vision"
  }, () => {});
  assert.equal(captured.url, "https://sparkapi.org/v1/responses");
  assert.equal(captured.options.headers.authorization, "Bearer account-key");
  assert.equal(resolvedAccountTokenIds.at(-1), undefined, "Responses top-level Agent models must not select an image-model token binding");
  assert.equal(JSON.parse(captured.options.body).group, undefined);
  assert.equal(accountResponsesImage.data[0].b64_json, "ZmluYWwtaW1hZ2U=");

  transport = async () => response({
    contentType: "text/event-stream; charset=utf-8",
    data: 'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":{"image_base64":"Y29tcGxldGVkLW9ubHk="}}]}}\n\n'
  });
  const completedOnlyImage = await client.newApiRelayResponsesImage(settings, {
    model: "gpt-5.6-sol",
    input: "completed only",
    tools: [{ type: "image_generation", action: "generate" }]
  }, () => {});
  assert.equal(completedOnlyImage.data[0].b64_json, "Y29tcGxldGVkLW9ubHk=");

  transport = async () => response({
    contentType: "application/json; charset=utf-8",
    status: 400,
    data: { error: { message: "image_generation tool is not supported by the Responses API" } }
  });
  await assert.rejects(
    () => client.newApiRelayResponsesImage(settings, {
      model: "gpt-5.6-sol",
      input: "unsupported",
      tools: [{ type: "image_generation", action: "generate" }]
    }, () => {}),
    (error) => error?.code === "NEW_API_RESPONSES_IMAGE_UNSUPPORTED"
  );

  transport = async () => response({ contentType: "text/event-stream; charset=utf-8", data: "data: [DONE]\n\n" });
  await assert.rejects(
    () => client.newApiRelayResponsesImage(settings, {
      model: "gpt-5.6-sol",
      input: "empty stream",
      tools: [{ type: "image_generation", action: "generate" }]
    }, () => {}),
    (error) => error?.code === "NEW_API_EMPTY_STREAM_OUTPUT" && error?.unsafeToRetry === true
  );

  transport = async () => response({
    contentType: "text/event-stream; charset=utf-8",
    data: 'data: {"type":"response.incomplete","response":{"error":{"message":"upstream image generation stopped"}}}\n\n'
  });
  await assert.rejects(
    () => client.newApiRelayResponsesImage(settings, {
      model: "gpt-5.6-sol",
      input: "incomplete stream",
      tools: [{ type: "image_generation", action: "generate" }]
    }, () => {}),
    (error) => error?.code === "NEW_API_RESPONSES_IMAGE_INCOMPLETE" && error?.unsafeToRetry === true
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 18,
    v1BaseUrlDeduplication: true,
    jsonResponsesFallback: true,
    emptyStreamRejected: true,
    customGroupRemoved: true,
    customJsonBodyForwarded: true,
    perModelCustomCredentials: true,
    perModelAccountCredentials: true,
    formDataModelBinding: true,
    responsesModelBindingIgnored: true,
    responsesImageStreaming: true,
    accountResponsesImageStreaming: true,
    responsesImageThreePreviews: true,
    responsesImageFinalDeduplication: true,
    responsesImageUnsupportedClassified: true,
    ambiguousResponsesImageNotRetryable: true
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
