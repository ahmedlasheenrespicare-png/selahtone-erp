/** Read-only membership diagnostic on a disposable PGlite database only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditTestOnlyPeriod } from "../prototypes/finance-cutover-period-audit/audit.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

const read = (p: string) => readFileSync(join(process.cwd(),p), "utf8");
test("synthetic read-only period comparison exposes mismatched IDs and exact timestamp boundaries", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql","tests/fixtures/finance-legacy-categories.sql","tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; ALTER TABLE public.commerce_collections ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'; SET selahtone.collection_policy_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql","prototypes/finance-collection-policy/allocations.test-only.sql"]) await pg.exec(read(f));
    await pg.exec(`INSERT INTO public.users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES (2,'CS_AGENT','موظف اصطناعي','audit-second@example.test','fixture','ACTIVE',false);
      INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by,opened_at) VALUES
        (1,'CUSTODY',3,0,'2026-01-01',1,'2026-01-01 00:00:00+00'),(2,'CUSTODY',5,0,'2026-01-01',1,'2026-01-01 00:00:00+00');
      UPDATE finance.accounts SET closed_at='2026-02-03',closed_by=1 WHERE id=1;
      INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,status,resolved_by,resolved_at,resolution_reason,transfer_amount,transfer_direction)
        VALUES(1,1,3,0,0,0,0,0,0,0,'تسوية اصطناعية','CONFIRMED',1,'2026-02-01 00:00:00+00','اعتماد اصطناعي',0,'TO_VAULT');
      INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
        VALUES(1,1,3,0,0,0,0,0,0,0,'مفتوحة اصطناعية');
      INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by)
        VALUES(1,0,0,0,0,'2026-02-01','جرد اصطناعي',1);
      INSERT INTO commerce_sales(branch_id,created_by_id) VALUES (1,3),(1,1),(2,5);
      INSERT INTO commerce_collections(sale_id,amount,method,created_by_id,created_at) VALUES
        (1,10,'CASH',3,'2026-02-02'), (1,7,'CASH',1,'2026-02-02'), (2,7,'CASH',3,'2026-02-02'),
        (1,2,'CASH',3,'2026-02-01'), (1,9,'CASH',3,'2026-02-02'), (1,1,'CASH',3,'2026-02-01'),
        (1,80,'CARD',3,'2026-02-02'), (3,70,'CASH',5,'2026-02-02'), (1,6,'CASH',3,'2026-02-02'),
        (1,11,'CASH',3,'2026-02-04'), (1,12,'CASH',3,'2026-02-03');
      INSERT INTO finance.collection_allocations_test_only(collection_id,account_id,treatment,assigned_by,settlement_id) VALUES
        (1,1,'CUSTODY_PENDING',3,NULL),(3,1,'CUSTODY_PENDING',3,NULL),(4,1,'CUSTODY_PENDING',3,NULL),
        (5,2,'CUSTODY_PENDING',3,NULL),(7,1,'CUSTODY_PENDING',3,NULL),(9,1,'CUSTODY_PENDING',3,1),(10,1,'CUSTODY_PENDING',3,NULL);
      INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at) VALUES
        (1,1,'اختبار',4,'2026-02-02','تجريبي','PAID',3,1,'2026-02-02'),
        (1,1,'اختبار',6,'2026-02-02','تجريبي','PAID',3,1,'2026-02-02'),
        (1,1,'اختبار',6,'2026-02-02','تجريبي','PAID',1,1,'2026-02-02'),
        (1,1,'اختبار',3,'2026-02-02','تجريبي','PAID',3,1,'2026-02-02'),
        (1,1,'اختبار',8,'2026-02-02','تجريبي','PAID',3,1,'2026-02-02'),
        (1,1,'اختبار',13,'2026-02-02','تجريبي','PAID',3,1,'2026-02-02'),
        (1,1,'اختبار',14,'2026-02-02','تجريبي','PAID',3,1,'2026-02-02'),
        (1,1,'اختبار',15,'2026-02-02','تجريبي','PAID',3,1,'2026-02-02');
      INSERT INTO finance.payments(expense_id,amount,method,payment_date,recorded_by,actually_paid,source,recorded_at) VALUES
        (1,4,'CASH','2026-02-02',3,true,'HOLDER_CASH','2026-02-02'),
        (2,6,'CASH','2026-02-02',1,true,'HOLDER_CASH','2026-02-02'),
        (3,6,'CASH','2026-02-02',1,true,'HOLDER_CASH','2026-02-02'),
        (4,3,'CASH','2026-02-02',3,true,'HOLDER_CASH','2026-02-01'),
        (5,8,'CASH','2026-02-02',3,true,'HOLDER_CASH','2026-02-02'),
        (6,13,'CASH','2026-02-02',3,true,'HOLDER_CASH','2026-02-04'),
        (7,14,'CASH','2026-02-02',3,true,'HOLDER_CASH','2026-02-03'),
        (8,15,'CARD','2026-02-02',3,true,'ACCOUNT','2026-02-02');
      INSERT INTO finance.holder_payment_allocations_test_only(payment_id,account_id,assigned_by,settlement_id) VALUES
        (1,1,3,NULL),(3,1,1,NULL),(4,1,3,NULL),(5,1,3,1),(6,1,3,NULL),(8,1,3,NULL);`);
    const port = (tx: { query: (q: string,p?: unknown[]) => Promise<{ rows: unknown[] }> }): FinanceTransaction => ({ query: async <T extends Record<string,unknown>>(q: string,p: unknown[] = []) => ({ rows: (await tx.query(q,p)).rows as T[] }) });
    const run = (id: string, mode = "REPEATABLE READ READ ONLY") => pg.transaction(async tx => {
      await tx.query(`SET TRANSACTION ISOLATION LEVEL ${mode}`);
      return auditTestOnlyPeriod(port(tx),id);
    });
    await assert.rejects(() => run("1"), /explicit opt-in/);
    await pg.exec("SET selahtone.cutover_period_audit_test_only='yes'");
    await assert.rejects(() => run("1", "REPEATABLE READ READ WRITE"), /read-only repeatable snapshot/);
    await assert.rejects(() => run("1", "READ COMMITTED READ ONLY"), /read-only repeatable snapshot/);
    const snapshot = async () => {
      const tables = ["finance.accounts","finance.settlements","finance.cash_counts","finance.movements","finance.expenses","finance.payments","finance.collection_allocations_test_only","finance.holder_payment_allocations_test_only","public.commerce_sales","public.commerce_collections"];
      return Promise.all(tables.map(async t => (await pg.query<{ rows: string }>(`SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text AS rows FROM ${t} x`)).rows[0].rows));
    };
    const before = await snapshot();
    const report = await run("1");
    const ids = (items: { id: string }[]) => items.map(x => x.id);
    assert.equal(report.context.accountId,"1"); assert.equal(report.context.closed,true); assert.equal(report.context.openSettlements,1); assert.equal(report.context.openCounts,1);
    assert.match(report.context.cutoff,/2026-02-01 00:00:00/);
    assert.equal(report.context.cutoffBeforeOpening,false); assert.equal(report.context.cutoffAfterClosure,false);
    assert.deepEqual(ids(report.collections.matched),["1","10"]);
    assert.deepEqual(ids(report.collections.oldOnly),["2","5","9","11"]);
    assert.deepEqual(ids(report.collections.candidateOnly),["3","4","7"]);
    assert.deepEqual(ids(report.collections.invalidCandidate),["7"]);
    assert.deepEqual(ids(report.collections.boundary),["4","6"]);
    assert.deepEqual(ids(report.collections.afterClosure),["10"]); assert.deepEqual(ids(report.collections.closureBoundary),["11"]);
    assert.equal(report.collections.oldOnly.find(x => x.id === "5")?.assignedAccountId,"2");
    assert.equal(report.collections.oldOnly.find(x => x.id === "9")?.assignedSettlementId,"1");
    assert.deepEqual(ids(report.payments.matched),["1","6"]);
    assert.deepEqual(ids(report.payments.oldOnly),["2","5","7"]);
    assert.deepEqual(ids(report.payments.candidateOnly),["3","4","8"]);
    assert.deepEqual(ids(report.payments.invalidCandidate),["3","8"]);
    assert.deepEqual(ids(report.payments.boundary),["4"]);
    assert.deepEqual(ids(report.payments.afterClosure),["6"]); assert.deepEqual(ids(report.payments.closureBoundary),["7"]);
    assert.equal(report.payments.oldOnly.find(x => x.id === "5")?.assignedSettlementId,"1");
    // Equal value swaps (collection 2 vs 3, payment 2 vs 3) remain visible as different IDs.
    assert.equal(report.collections.oldOnly[0].amount,report.collections.candidateOnly[0].amount);
    assert.equal(report.payments.oldOnly[0].amount,report.payments.candidateOnly[0].amount);
    assert.ok(report.collections.matched.some(x => x.id === "10" && x.afterClosure), "agreement on IDs can coexist with a timestamp after closure");
    assert.ok(report.payments.matched.some(x => x.id === "6" && x.afterClosure));
    assert.deepEqual(await snapshot(),before,"read-only audit must not change any records");
    // Inconsistent synthetic timestamp histories are review leads, not proof
    // of transaction ordering or grounds for automatic assignment.
    await pg.exec("UPDATE finance.settlements SET resolved_at='2026-02-04' WHERE id=1");
    assert.equal((await run("1")).context.cutoffAfterClosure,true);
    await pg.exec("UPDATE finance.settlements SET resolved_at='2025-12-31' WHERE id=1");
    assert.equal((await run("1")).context.cutoffBeforeOpening,true);
    await pg.exec("UPDATE finance.settlements SET resolved_at='2026-02-01' WHERE id=1");
    assert.deepEqual(await snapshot(),before,"timestamp fixtures are restored");
    const empty = await run("2");
    assert.deepEqual(ids(empty.collections.matched),[]);
    assert.deepEqual(ids(empty.collections.oldOnly),["8"]);
    assert.deepEqual(ids(empty.collections.candidateOnly),["5"]); // deliberately wrong-branch allocation
    assert.deepEqual(ids(empty.collections.invalidCandidate),["5"]);
    await assert.rejects(() => run("1 OR 1=1"), /invalid synthetic account id/);
    await assert.rejects(() => run("999"), /synthetic custody not found/);
    await pg.transaction(async tx => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await assert.rejects(() => tx.query("DELETE FROM finance.accounts"), /read-only/i);
    });
  } finally { await pg.close(); }
});
