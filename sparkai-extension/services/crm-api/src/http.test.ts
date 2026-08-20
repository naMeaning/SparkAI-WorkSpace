import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { bindCorsOrigin, fail, json, parseListLimit, parsePositiveInteger, readJsonBody } from "./http.js";
import type { CrmHttpError } from "./types.js";

function requestFromText(text: string): IncomingMessage {
  return Readable.from([Buffer.from(text)]) as unknown as IncomingMessage;
}

test("json allows credentialed CRM API calls from the request origin", () => {
  let headers: Record<string, string> = {};
  const response = {
    writeHead(_statusCode: number, nextHeaders: Record<string, string>) {
      headers = nextHeaders;
    },
    end() {
      // Test only needs headers.
    }
  } as unknown as Parameters<typeof json>[0];

  json(response, 200, { ok: true }, { origin: "http://127.0.0.1:5177" });

  assert.equal(headers["access-control-allow-origin"], "http://127.0.0.1:5177");
  assert.equal(headers["access-control-allow-credentials"], "true");
  assert.match(headers["access-control-allow-headers"], /content-type/);
});

test("bindCorsOrigin only reflects allowed credentialed origins", () => {
  function createResponse() {
    let headers: Record<string, string> = {};
    const response = {
      writeHead(_statusCode: number, nextHeaders: Record<string, string>) {
        headers = nextHeaders;
      },
      end() {
        // Test only needs headers.
      }
    } as unknown as Parameters<typeof json>[0];
    return {
      response,
      headers: () => headers
    };
  }

  const allowed = createResponse();
  (bindCorsOrigin as unknown as (res: Parameters<typeof json>[0], origin: string, allowedOrigins: string[]) => void)(
    allowed.response,
    "https://crm.example.com",
    ["https://crm.example.com"]
  );
  json(allowed.response, 200, { ok: true });
  assert.equal(allowed.headers()["access-control-allow-origin"], "https://crm.example.com");

  const blocked = createResponse();
  (bindCorsOrigin as unknown as (res: Parameters<typeof json>[0], origin: string, allowedOrigins: string[]) => void)(
    blocked.response,
    "https://evil.example.com",
    ["https://crm.example.com"]
  );
  json(blocked.response, 200, { ok: true });
  assert.equal(blocked.headers()["access-control-allow-origin"], undefined);
  assert.equal(blocked.headers()["access-control-allow-credentials"], undefined);
});

test("fail returns stable error codes and Chinese messages without internal details", () => {
  let statusCode = 200;
  let payload: Record<string, unknown> = {};
  const response = {
    writeHead(nextStatusCode: number) {
      statusCode = nextStatusCode;
    },
    end(chunk: unknown) {
      payload = JSON.parse(String(chunk || "{}")) as Record<string, unknown>;
    }
  } as unknown as Parameters<typeof fail>[0];

  fail(response, 503, "crm_database_not_ready", "Table 'ai_native_crm.crm_users' doesn't exist");

  assert.equal(statusCode, 503);
  assert.deepEqual(payload, {
    ok: false,
    error_code: "crm_database_not_ready",
    err_msg: "系统正在初始化，请先完成 CRM 数据库迁移后再登录。"
  });
});

test("readJsonBody reports invalid JSON as a 400 error", async () => {
  await assert.rejects(
    () => readJsonBody(requestFromText("{invalid")),
    (error: unknown) => {
      const httpError = error as CrmHttpError;
      assert.equal(httpError.statusCode, 400);
      assert.equal(httpError.code, "invalid_json");
      return true;
    }
  );
});

test("readJsonBody rejects bodies over the fixed size limit", async () => {
  const oversized = "x".repeat(1024 * 1024 + 1);

  await assert.rejects(
    () => readJsonBody(requestFromText(oversized)),
    (error: unknown) => {
      const httpError = error as CrmHttpError;
      assert.equal(httpError.statusCode, 413);
      assert.equal(httpError.code, "request_body_too_large");
      return true;
    }
  );
});

test("parsePositiveInteger maps validation failures to 400", () => {
  assert.throws(
    () => parsePositiveInteger("abc", "crmUserId"),
    (error: unknown) => {
      const httpError = error as CrmHttpError;
      assert.equal(httpError.statusCode, 400);
      assert.equal(httpError.code, "invalid_request");
      return true;
    }
  );
});

test("parseListLimit validates and caps list limits", () => {
  assert.equal(parseListLimit("", 50, 100), 50);
  assert.equal(parseListLimit("999", 50, 100), 100);
  assert.throws(
    () => parseListLimit("-1", 50, 100),
    (error: unknown) => {
      const httpError = error as CrmHttpError;
      assert.equal(httpError.statusCode, 400);
      return true;
    }
  );
});
