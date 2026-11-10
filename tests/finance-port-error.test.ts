import assert from "node:assert/strict";
import test from "node:test";
import { financePort, sqlError } from "../src/lib/finance/port";
import { isRetryableTransactionConflict } from "../src/lib/transaction-retry";

test("finance SQL error normalization preserves valid PostgreSQL states", async () => {
  for (const pgCode of ["40001", "40P01", "23505", "23514"]) {
    const raw = { code: "P2010", meta: { code: "N/A", driverAdapterError: { cause: { originalCode: pgCode, originalMessage: 'constraint "example_constraint"' } } } };
    let converted: unknown;
    try { await financePort({ $queryRawUnsafe: async () => { throw raw; } }).query("SELECT 1"); }
    catch (error) { converted = error; }
    assert.ok(converted instanceof Error);
    assert.equal((converted as Error & { code: string }).code, pgCode);
    assert.equal((converted as Error & { constraint: string }).constraint, "example_constraint");
    assert.equal(isRetryableTransactionConflict(converted), pgCode === "40001" || pgCode === "40P01");
  }
  const direct = { code: "P2010", meta: { code: "23514", driverAdapterError: { cause: { originalCode: "40001" } } } };
  assert.throws(() => sqlError(direct), (error: unknown) => error instanceof Error && "code" in error && error.code === "23514");
  const unknown = { code: "P2010", meta: { code: "N/A", driverAdapterError: { cause: { originalCode: "unknown" } } } };
  assert.throws(() => sqlError(unknown), (error: unknown) => error === unknown);
  const unrelated = { code: "OTHER", meta: { code: "40001" } };
  assert.throws(() => sqlError(unrelated), (error: unknown) => error === unrelated);
  assert.throws(() => sqlError({ code: "P2034" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "40001");
});
