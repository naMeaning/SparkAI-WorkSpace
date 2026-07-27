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
    settingsPath: "memory://settings.json",
    writeJson: () => {}
  });
  const settings = {
    accessMode: "custom",
    agentBaseUrl: "https://gateway.example/v1/",
    agentApiKey: "agent-key",
    imageBaseUrl: "https://images.example",
    imageApiKey: "image-key",
    modelGroup: "must-not-leak"
  };

  assert.equal(client.customApiUrl(settings, "/v1/responses"), "https://gateway.example/v1/responses");
  assert.equal(client.customApiUrl(settings, "v1/chat/completions"), "https://gateway.example/v1/chat/completions");
  assert.equal(client.customApiUrl(settings, "/v1/images/generations", "image"), "https://images.example/v1/images/generations");

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
  assert.equal(captured.options.headers.authorization, "Bearer image-key");
  const forwardedImageBody = JSON.parse(captured.options.body);
  assert.equal(Object.hasOwn(forwardedImageBody, "group"), false);
  assert.equal(forwardedImageBody.model, imageBody.model);
  assert.equal(forwardedImageBody.prompt, imageBody.prompt);
  assert.equal(forwardedImageBody.size, "1024x1024");
  assert.equal(forwardedImageBody.quality, "high");
  assert.equal(forwardedImageBody.n, 1);

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

  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 7,
    v1BaseUrlDeduplication: true,
    jsonResponsesFallback: true,
    emptyStreamRejected: true,
    customGroupRemoved: true,
    customJsonBodyForwarded: true
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
