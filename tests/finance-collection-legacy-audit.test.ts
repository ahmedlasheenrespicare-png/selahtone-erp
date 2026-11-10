/** Read-only audit on an in-memory synthetic database, not an automatic migration. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditLegacyTestBranch } from "../prototypes/finance-collection-policy/legacy-audit.test-only";
import { openAccount } from "../src/lib/finance/engine";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";

test("read-only synthetic legacy audit reports ambiguity and inconsistent evidence without modifying history", { timeout: 120_000 }, async () => {
  const pg = new PGlite(); const sql = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(sql(f));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; ALTER TABLE public.commerce_collections ADD COLUMN created_by_id bigint;");
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql"]) await pg.exec(sql(f));
    const db: FinanceDatabase = { serializable: (work) => pg.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(query: string, params: unknown[] = []) => ({ rows: (await tx.query(query, params)).rows as T[] }) };
      return work(port);
    }) };
    for (const [kind, holderId] of [["VAULT", null], ["CUSTODY", "3"]] as const)
      await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind, holderId, openingAmount: "0", openingDate: "2026-10-20", counted: true }, "2026-11-07");
    await pg.exec(`INSERT INTO commerce_sales(branch_id,created_by_id) VALUES (1,1),(1,3),(2,1);
      INSERT INTO commerce_collections(sale_id,amount,method,created_by_id) VALUES
        (1,10,'CASH',3),(1,20,'CASH',1),(1,30,'CASH',1),(1,40,'CASH',3),(1,5,'CARD',3),(2,50,'CASH',1),(3,999,'CASH',3);
      INSERT INTO finance.movements(kind,branch_id,destination_id,amount,external_ref,actor_id) VALUES
        ('COLLECTION',1,1,20,'collection:2',1),('COLLECTION',1,1,31,'collection:3',1),('COLLECTION',1,1,7,'collection:999',1);
      INSERT INTO finance.historical_commerce(event_type,event_id,sale_id,branch_id,account_id,amount,actual_date,checkpoint_type,checkpoint_date,verified_actual,before_checkpoint,included_in_checkpoint,not_previously_recorded,handler,reason,created_by) VALUES
        ('COLLECTION',3,1,1,1,30,'2026-10-19','OPENING','2026-10-20',true,true,true,true,'اصطناعي','مراجعة',1),
        ('COLLECTION',4,1,1,1,40,'2026-10-19','OPENING','2026-10-20',true,true,true,true,'اصطناعي','مراجعة',1),
        ('COLLECTION',999,1,1,1,7,'2026-10-19','OPENING','2026-10-20',true,true,true,true,'اصطناعي','مراجعة',1);
      INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
        VALUES (1,1,'تجريبي',6,'2026-10-21','تجريبي','PAID',3,1,now());
      INSERT INTO finance.payments(expense_id,amount,method,account_id,payment_date,recorded_by,actually_paid,source)
        VALUES (1,6,'CASH',NULL,'2026-10-21',1,true,'HOLDER_CASH');
      INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
        VALUES (2,1,3,0,0,0,0,0,0,0,'مفتوحة');
      INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,status,resolved_by,resolved_at,resolution_reason,transfer_amount,transfer_direction)
        VALUES (2,1,3,0,0,0,0,0,0,0,'تسوية سابقة','CONFIRMED',1,now(),'تجريبي',0,'TO_VAULT');
      INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by)
        VALUES (2,0,0,0,0,'2026-10-21','جرد اصطناعي',1);`);
    const snapshot = async () => (await pg.query("SELECT (SELECT count(*) FROM finance.movements)::text AS m,(SELECT count(*) FROM finance.historical_commerce)::text AS h,(SELECT count(*) FROM commerce_collections)::text AS c,(SELECT count(*) FROM finance.settlements)::text AS s")).rows[0];
    const before = await snapshot();
    const audit = await db.serializable((tx) => auditLegacyTestBranch(tx, "1"));
    assert.deepEqual(audit, { cashCount: "5", cashAmount: "150.00", differentRecorderCount: "3", differentRecorderAmount: "100.00", noEvidenceCount: "2", noEvidenceAmount: "60.00", movementOnlyCount: "1", historicalOnlyCount: "1", overlapCount: "1", inconsistentEvidenceCount: "1", orphanMovementCount: "1", orphanHistoricalCount: "1", holderCashCount: "1", holderCashAmount: "6.00", holderCashDifferentRecorderCount: "1", openSettlements: "1", confirmedSettlements: "1", openCounts: "1" });
    const empty = await db.serializable((tx) => auditLegacyTestBranch(tx, "2"));
    assert.equal(empty.cashCount, "1"); assert.equal(empty.cashAmount, "999.00"); assert.equal(empty.noEvidenceCount, "1");
    assert.deepEqual(await snapshot(), before, "the audit must not alter any record");
    await assert.rejects(() => db.serializable((tx) => auditLegacyTestBranch(tx, "1 OR 1=1")), /invalid synthetic branch/);
  } finally { await pg.close(); }
});
