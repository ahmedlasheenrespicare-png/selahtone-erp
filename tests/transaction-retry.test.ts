import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableTransactionConflict } from "../src/lib/transaction-retry";

test("retry only explicit serialization and deadlock errors", () => {
  for (const code of ["P2034", "40001", "40P01"]) assert.equal(isRetryableTransactionConflict({ code }), true);
  for (const code of ["40001", "40P01"]) {
    assert.equal(isRetryableTransactionConflict({ code: "P2010", meta: { code } }), true);
    assert.equal(isRetryableTransactionConflict({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: code } } } }), true);
  }
  for (const value of [null, new Error("40001"), { code: "P2002" }, { code: "P2010", meta: { code: "23505" } }, { code: "P2010" }, { code: "other", meta: { code: "40001" } }]) {
    assert.equal(isRetryableTransactionConflict(value), false);
  }
});
