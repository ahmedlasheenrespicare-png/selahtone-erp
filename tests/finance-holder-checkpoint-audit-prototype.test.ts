import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticHolderCheckpoints } from "../prototypes/finance-holder-checkpoint-audit/audit.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("synthetic holder checkpoint inventory preserves ambiguous candidates and pagination", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.expenses (id bigint PRIMARY KEY, branch_id bigint NOT NULL, requested_by bigint NOT NULL);
      CREATE TABLE finance.payments (id bigint PRIMARY KEY, expense_id bigint NOT NULL, amount numeric(14,2), payment_date date, recorded_at timestamptz, recorded_by bigint, source text);
      CREATE TABLE finance.accounts (id bigint PRIMARY KEY, branch_id bigint, holder_id bigint, kind text, opening_date date, opened_at timestamptz, closed_at timestamptz);
      CREATE TABLE finance.settlements (id bigint PRIMARY KEY, account_id bigint, status text, resolved_at timestamptz);
      CREATE TABLE finance.cash_counts (id bigint PRIMARY KEY, account_id bigint, status text, counted_on date, resolved_at timestamptz);
      INSERT INTO finance.expenses VALUES (1,1,3),(2,1,4),(3,1,5),(4,2,3),(5,1,3);
      INSERT INTO finance.payments VALUES
        (1,1,10,'2026-03-01','2026-03-05 10:00Z',3,'HOLDER_CASH'),
        (2,2,20,'2026-03-01','2026-03-05 10:00Z',9,'HOLDER_CASH'),
        (3,3,30,'2026-03-05','2026-03-05 11:00Z',5,'HOLDER_CASH'),
        (4,4,40,'2026-03-01','2026-03-05 10:00Z',3,'HOLDER_CASH'),
        (5,5,50,'2026-03-01','2026-03-05 10:00Z',3,'ACCOUNT');
      INSERT INTO finance.accounts VALUES
        (10,1,3,'CUSTODY','2026-03-02','2026-03-02 09:00Z','2026-03-03 09:00Z'),
        (11,1,3,'CUSTODY','2026-03-04','2026-03-04 09:00Z',NULL),
        (12,1,5,'CUSTODY','2026-03-05','2026-03-05 09:00Z',NULL),
        (13,2,3,'CUSTODY','2026-03-01','2026-03-01 09:00Z',NULL),
        (14,1,4,'VAULT','2026-03-01','2026-03-01 09:00Z',NULL);
      INSERT INTO finance.settlements VALUES (20,10,'CONFIRMED','2026-03-03 21:59:00Z'), (21,11,'CONFIRMED','2026-03-05 10:30:00Z'),(22,11,'OPEN',NULL),(23,11,'CONFIRMED','2026-03-05 10:00:00Z');
      INSERT INTO finance.cash_counts VALUES (30,10,'CONFIRMED','2026-03-03','2026-03-03 12:00Z'),(31,11,'OPEN','2026-03-05',NULL),
        (32,12,'CONFIRMED','2026-03-05','2026-03-05 10:00Z');`);
    const tx: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await db.query(sql, params)).rows as T[] }) };
    await assert.rejects(() => auditSyntheticHolderCheckpoints(tx, "1", "0", 1), /opt-in/);
    await assert.rejects(() => auditSyntheticHolderCheckpoints(tx, "1 OR 1=1", "0", 1), /invalid/);
    await assert.rejects(() => auditSyntheticHolderCheckpoints(tx, "1", "0", 0), /invalid/);
    await db.exec("BEGIN READ ONLY; SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
    const first = await auditSyntheticHolderCheckpoints(tx, "1", "0", 1);
    assert.equal(first.nextAfterId, "1");
    assert.deepEqual(first.rows.map(r => [r.accountId, r.referenceType, r.referenceId]), [["10","COUNT","30"],["10","OPENING","10"],["10","SETTLEMENT","20"],["11","OPENING","11"],["11","SETTLEMENT","23"],["11","SETTLEMENT","21"]]);
    assert.ok(first.rows.every(r => r.dateBefore === true));
    assert.equal(first.rows.find(r => r.referenceId === "21")?.recordedAfter, false, "recorded before settlement is distinct evidence");
    assert.equal(first.rows.find(r => r.referenceId === "23")?.recordedEqual, true, "timestamp ties are explicitly ambiguous");
    assert.equal(first.rows.find(r => r.referenceId === "20")?.referenceDate, "2026-03-03", "settlement day is Cairo local");
    const second = await auditSyntheticHolderCheckpoints(tx, "1", first.nextAfterId!, 1);
    assert.equal(second.nextAfterId, "2"); assert.equal(second.rows.length, 1);
    assert.equal(second.rows[0].accountId, null, "missing custody is not silently assigned");
    assert.equal(second.rows[0].recorderId, "9"); assert.equal(second.rows[0].requesterId, "4");
    assert.equal(second.rows[0].referenceType, null);
    const third = await auditSyntheticHolderCheckpoints(tx, "1", second.nextAfterId!, 1);
    assert.equal(third.nextAfterId, null);
    assert.deepEqual(third.rows.map(r => [r.referenceType, r.dateBefore, r.dateSame, r.recordedAfter]), [["COUNT",false,true,true],["OPENING",false,true,true]]);
    const branch2 = await auditSyntheticHolderCheckpoints(tx, "2", "0", 10);
    assert.deepEqual([...new Set(branch2.rows.map(r => r.paymentId))], ["4"]);
    await assert.rejects(() => db.exec("UPDATE finance.payments SET amount=0"), /read.only/i);
    await db.exec("ROLLBACK");
    assert.equal((await db.query<{ amount: string }>("SELECT amount::text AS amount FROM finance.payments WHERE id=1")).rows[0].amount, "10.00");
  } finally { await db.close(); }
});
