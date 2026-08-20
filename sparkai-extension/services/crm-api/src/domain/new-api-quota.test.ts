import test from "node:test";
import assert from "node:assert/strict";
import { convertRmbToNewApiQuota } from "./new-api-quota.js";

test("convertRmbToNewApiQuota uses explicit integer rounding", () => {
  assert.equal(convertRmbToNewApiQuota(10, 500000), 5000000);
  assert.equal(convertRmbToNewApiQuota(0.01, 500000), 5000);
  assert.equal(convertRmbToNewApiQuota(29.9, 500000), 14950000);
  assert.throws(() => convertRmbToNewApiQuota(0, 500000), /amountRmb must be positive/);
  assert.throws(() => convertRmbToNewApiQuota(1, 0), /quotaPerRmb must be positive/);
});
