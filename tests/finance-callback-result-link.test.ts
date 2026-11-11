/**
 * Disposable PGlite tests for the strict identity link of the lab engine's
 * commerce transaction callbacks. No DATABASE_URL, no business data, no
 * production SQL, no proof of a cash movement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import {
  openAccount, postCashCollectionInTransaction, postCashRefundInTransaction,
  recordHistoricalCommerceInTransaction, assertAfterLatestCheckpointInTransaction,
} from "../prototypes/finance-engine/engine";
import { RESULT_TABLES } from "../prototypes/finance-engine/request-result-link";
import {
  CALLBACK_RESULT_TABLE_BY_ACTION, callbackRequestId, requireCallbackResultLink,
  saveCallbackResultLink,
} from "../prototypes/finance-engine/transaction-callback-link";

const schema = readFileSync("prototypes/finance-engine/schema.test-only.sql", "utf8");
const req = () => randomUUID();
const today = "2026-10-29";
const forbidden = (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden";
type LinkRow = { action: string; actorId: string; resultTable: string; resultId: string };

function adapter(pg: PGlite): FinanceDatabase {
  return { serializable: work => pg.transaction(async tx => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const executor: FinanceTransaction = {
      query: async (sql, parameters = []) => ({ rows: (await tx.query(sql, parameters)).rows as never[] }),
    };
    return work(executor);
  }) };
}
async function fresh(): Promise<{ pg: PGlite; db: FinanceDatabase; vault: string; custody: string }> {
  const pg = new PGlite();
  await pg.exec("SET selahtone.finance_lab_test_only = 'yes'");
  await pg.exec(schema);
  await pg.exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) VALUES(1,'فرع تجريبي',TRUE);
    INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name) VALUES
    (1,NULL,'MANAGER','ACTIVE',FALSE,'مدير'),(2,NULL,'ACCOUNTANT','ACTIVE',FALSE,'محاسب'),
    (3,1,'CS_AGENT','ACTIVE',FALSE,'موظف أول');`);
  const db = adapter(pg);
  const vault = await openAccount(db, "1", {
    requestId: req(), branchId: "1", kind: "VAULT", holderId: null,
    openingAmount: "1000.00", openingDate: "2026-10-20", counted: true,
  }, today);
  const custody = await openAccount(db, "2", {
    requestId: req(), branchId: "1", kind: "CUSTODY", holderId: "3",
    openingAmount: "0", openingDate: "2026-10-20", counted: true,
  }, today);
  return { pg, db, vault: vault.id, custody: custody.id };
}
async function linkRow(pg: PGlite, requestId: string): Promise<LinkRow | undefined> {
  return (await pg.query<LinkRow>(`SELECT action,actor_id::text AS "actorId",
    result_table AS "resultTable",result_id::text AS "resultId"
    FROM finance_lab.request_results WHERE request_id=$1::uuid`, [requestId])).rows[0];
}
async function callbackLinkCount(pg: PGlite): Promise<number> {
  return (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance_lab.request_results
    WHERE action IN ('CASH_COLLECTION','CASH_REFUND','HISTORICAL_COMMERCE')`)).rows[0].n;
}
async function movementCount(pg: PGlite): Promise<number> {
  return (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance_lab.movements`)).rows[0].n;
}
const collection = (custody: string, collectionId = "501") => ({
  branchId: "1", accountId: custody, amount: "100", collectionId,
});
const refund = (vault: string, refundId = "701") => ({
  branchId: "1", accountId: vault, amount: "10", refundId,
  expectedBalance: "1000.00", negativeAcknowledged: false,
});
const historical = (accountId: string, eventId = "9001") => ({
  eventType: "COLLECTION", eventId, saleId: "1", branchId: "1", accountId,
  amount: "8", actualDate: "2026-10-19", checkpointType: "OPENING", checkpointCountId: null,
  handler: "موظف وهمي", reason: "مستند تمت مراجعته",
  verifiedActual: true, beforeCheckpoint: true, includedInCheckpoint: true, notPreviouslyRecorded: true,
  caseSnapshot: "",
});

test("every row-creating commerce callback has a whitelisted result table", () => {
  assert.deepEqual(Object.keys(CALLBACK_RESULT_TABLE_BY_ACTION).sort(),
    ["CASH_COLLECTION", "CASH_REFUND", "HISTORICAL_COMMERCE"]);
  for (const [action, table] of Object.entries(CALLBACK_RESULT_TABLE_BY_ACTION)) {
    assert.ok(RESULT_TABLES.has(table), `unwhitelisted table for ${action}`);
  }
  const a = callbackRequestId("CASH_COLLECTION", "collection:501");
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(a, callbackRequestId("CASH_COLLECTION", "collection:501"));
  assert.notEqual(a, callbackRequestId("CASH_COLLECTION", "collection:502"));
  assert.notEqual(a, callbackRequestId("CASH_REFUND", "collection:501"));
});

test("collection, refund and historical callbacks save strict links in the same transaction", { timeout: 180_000 }, async () => {
  const { pg, db, vault, custody } = await fresh();
  try {
    const movementId = await db.serializable(tx => postCashCollectionInTransaction(tx, "3", collection(custody)));
    const refundId = await db.serializable(tx => postCashRefundInTransaction(tx, "2", refund(vault)));
    const historicalId = await db.serializable(tx => recordHistoricalCommerceInTransaction(tx, "1", historical(vault), today));

    const expected: Array<[string, string, string, string, string]> = [
      ["CASH_COLLECTION", "collection:501", "3", "finance_lab.movements", movementId],
      ["CASH_REFUND", "refund:701", "2", "finance_lab.movements", refundId],
      ["HISTORICAL_COMMERCE", "collection:9001", "1", "finance_lab.historical_commerce", historicalId],
    ];
    for (const [action, externalRef, actorId, resultTable, resultId] of expected) {
      const link = await linkRow(pg, callbackRequestId(action, externalRef));
      assert.ok(link, `missing callback link for ${action}`);
      assert.deepEqual(link, { action, actorId, resultTable, resultId });
      await db.serializable(tx => requireCallbackResultLink(tx, action, externalRef,
        { action, actorId, resultId }));
    }
    assert.equal(await callbackLinkCount(pg), 3);
  } finally { await pg.close(); }
});

test("tampered, missing or mismatched callback links are refused; legacy rows are never back-filled", { timeout: 180_000 }, async () => {
  const { pg, db, custody } = await fresh();
  try {
    const resultId = await db.serializable(tx => postCashCollectionInTransaction(tx, "3", collection(custody)));
    const id = callbackRequestId("CASH_COLLECTION", "collection:501");
    const prior = { action: "CASH_COLLECTION", actorId: "3", resultId };

    // A tampered natural identity no longer matches the saved link.
    await pg.query("UPDATE finance_lab.movements SET external_ref='collection:999' WHERE id=$1::bigint", [resultId]);
    await assert.rejects(() => db.serializable(tx => requireCallbackResultLink(tx, "CASH_COLLECTION", "collection:501", prior)), forbidden);
    await pg.query("UPDATE finance_lab.movements SET external_ref='collection:501' WHERE id=$1::bigint", [resultId]);

    // A tampered link row pointing at another result is refused.
    await pg.query("UPDATE finance_lab.request_results SET result_id=999999 WHERE request_id=$1::uuid", [id]);
    await assert.rejects(() => db.serializable(tx => requireCallbackResultLink(tx, "CASH_COLLECTION", "collection:501", prior)), forbidden);
    await pg.query("UPDATE finance_lab.request_results SET result_id=$1::bigint WHERE request_id=$2::uuid", [resultId, id]);

    // Strict policy: a saved movement without a link is refused, not migrated.
    await pg.query("DELETE FROM finance_lab.request_results WHERE request_id=$1::uuid", [id]);
    await assert.rejects(() => db.serializable(tx => requireCallbackResultLink(tx, "CASH_COLLECTION", "collection:501", prior)), forbidden);
    assert.equal(await callbackLinkCount(pg), 0, "no link is derived from the old row");

    // Reusing a linked identity is a duplicate, never a second movement.
    await pg.query(`INSERT INTO finance_lab.request_results(request_id,action,actor_id,result_table,result_id)
      VALUES($1::uuid,'CASH_COLLECTION',3,'finance_lab.movements',$2::bigint)`, [id, resultId]);
    await assert.rejects(() => db.serializable(tx => postCashCollectionInTransaction(tx, "3", collection(custody))),
      (e: unknown) => e instanceof FinanceProblem && e.code === "duplicate");
    assert.equal(await movementCount(pg), 1, "no second movement");
  } finally { await pg.close(); }
});

test("an out-of-band movement with the same identity is refused before any write", { timeout: 180_000 }, async () => {
  const { pg, db, custody } = await fresh();
  try {
    await pg.query(`INSERT INTO finance_lab.movements(kind,branch_id,destination_id,amount,external_ref,actor_id,after_opening)
      VALUES('COLLECTION',1,$1::bigint,10,'collection:601',3,FALSE)`, [custody]);
    const before = await movementCount(pg);
    await assert.rejects(() => db.serializable(tx => postCashCollectionInTransaction(tx, "3", collection(custody, "601"))), forbidden);
    assert.equal(await movementCount(pg), before, "strict refusal writes nothing");
    assert.equal(await callbackLinkCount(pg), 0, "no link is fabricated for the legacy row");
  } finally { await pg.close(); }
});

test("unknown callback actions are refused and the read-only checkpoint guard creates no link", { timeout: 180_000 }, async () => {
  const { pg, db, custody } = await fresh();
  try {
    await assert.rejects(() => db.serializable(tx => saveCallbackResultLink(tx, "UNKNOWN", "x:1", "1", "1")), forbidden);
    await assert.rejects(() => db.serializable(tx => requireCallbackResultLink(tx, "UNKNOWN", "x:1",
      { action: "UNKNOWN", actorId: "1", resultId: "1" })), forbidden);
    await db.serializable(tx => assertAfterLatestCheckpointInTransaction(tx, "3", {
      branchId: "1", accountId: custody, checkpointRef: "OPENING", afterCheckpoint: true, refund: false,
    }));
    assert.equal(await callbackLinkCount(pg), 0, "a guard that creates no row needs no result link");
  } finally { await pg.close(); }
});
