import test from "node:test";
import assert from "node:assert/strict";
import { listLedger } from "./ledger.js";

test("listLedger validates and caps page size", async () => {
  const pages: Array<{ page?: number; pageSize?: number }> = [];
  const repository = {
    async listLedger(options?: { page?: number; pageSize?: number }) {
      pages.push(options || {});
      return { items: [], total: 0, page: options?.page || 1, pageSize: options?.pageSize || 20 };
    }
  };

  await listLedger({
    repository,
    url: new URL("http://127.0.0.1/crm/admin/ledger?page=2&pageSize=10000")
  });
  assert.deepEqual(pages, [{ page: 2, pageSize: 100 }]);

  await assert.rejects(
    () =>
      listLedger({
        repository,
        url: new URL("http://127.0.0.1/crm/admin/ledger?pageSize=abc")
      }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as { code?: string }).code, "invalid_request");
      return true;
    }
  );
});
