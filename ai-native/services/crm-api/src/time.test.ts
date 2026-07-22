import test from "node:test";
import assert from "node:assert/strict";
import { formatMysqlTimestamp } from "./time.js";

test("formatMysqlTimestamp returns a MySQL TIMESTAMP-safe UTC value", () => {
  const timestamp = formatMysqlTimestamp(new Date("2026-07-04T15:40:00.123Z"));

  assert.equal(timestamp, "2026-07-04 15:40:00");
  assert.equal(timestamp.includes("T"), false);
  assert.equal(timestamp.includes("Z"), false);
});
