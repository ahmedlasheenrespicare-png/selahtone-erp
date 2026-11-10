/** Synthetic regression; same-day physical order remains unresolved. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticHolderCheckpoints } from "../prototypes/finance-holder-checkpoint-audit/audit.test-only";
import { approveExpense, confirmSettlement, createExpense, openAccount, payExpense, requestSettlement, settlementOverview } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("holder cash rejects pre-opening and pre-settlement dates but permits the reference day", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql"]) await pg.exec(read(f));
    const db: FinanceDatabase = { serializable: work => pg.transaction(async tx => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query(sql, params)).rows as T[] }) };
      return work(port);
    }) };
    const today = "2026-11-07";
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "100", openingDate: "2026-10-20", counted: true }, today);
    // Make the distinct registration boundary deterministic, not an inference
    // about when cash physically changed hands.
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
    const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: "2026-10-19", description: "صرف اصطناعي سابق للافتتاح" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    const input = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: "2026-10-19", actuallyPaid: true, source: "HOLDER_CASH" };
    const before = (await pg.query(`SELECT a.revision::text AS revision,
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit FROM finance.accounts a WHERE a.id=$1::bigint`, [account.id])).rows[0];
    await assert.rejects(() => payExpense(db, "3", input, today), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_cash_before_period");
    assert.deepEqual((await pg.query(`SELECT a.revision::text AS revision,
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit FROM finance.accounts a WHERE a.id=$1::bigint`, [account.id])).rows[0], before);
    assert.equal((await settlementOverview(db, "3", account.id)).expected, "100.00");
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.expenses WHERE id=$1::bigint", [expense.id])).rows[0].status, "APPROVED");
    const sameDay = { ...input, paymentDate: "2026-10-20" };
    assert.equal((await payExpense(db, "3", sameDay, today)).replayed, false);
    assert.equal((await payExpense(db, "3", sameDay, today)).replayed, true);
    // Accepted same-day payment is not evidence it happened after opening.
    assert.equal((await settlementOverview(db, "3", account.id)).expected, "90.00");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    // A separate holder with no confirmed cash count also demonstrates an old
    // payment recorded after a confirmed settlement boundary.
    await pg.exec(`INSERT INTO public.users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password)
      VALUES(50,1,'CS_AGENT','موظف اصطناعي','settlement-opening-audit@test.local','x','ACTIVE',false)`);
    await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "100", openingDate: "2026-10-20", counted: true }, today);
    const firstSettlement = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: account.id, expectedBalance: "100", countedAmount: "90", reason: "تسوية اصطناعية بعد صرف", actuallyCounted: true });
    await confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: firstSettlement.id, expectedBalance: "100", transferAmount: "10", transferDirection: "TO_CUSTODY", reason: "اعتماد اصطناعي", actuallyTransferred: true });
    const beforeReplay = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.payments) AS payments,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision`, [account.id])).rows[0];
    assert.equal((await payExpense(db, "3", sameDay, today)).replayed, true);
    assert.deepEqual((await pg.query(`SELECT (SELECT count(*)::int FROM finance.payments) AS payments,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision`, [account.id])).rows[0], beforeReplay);
    const secondAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "50", openingAmount: "100", openingDate: "2026-10-20", counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [secondAccount.id]);
    const secondExpense = await createExpense(db, "50", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: "2026-10-21", description: "صرف اصطناعي سابق للتسوية" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: secondExpense.id, expectedRevision: "1" });
    const settlement = await requestSettlement(db, "50", { requestId: randomUUID(), accountId: secondAccount.id, expectedBalance: "100", countedAmount: "100", reason: "تسوية اصطناعية", actuallyCounted: true });
    await confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: settlement.id, expectedBalance: "100", transferAmount: "0", transferDirection: "TO_VAULT", reason: "اعتماد اصطناعي", actuallyTransferred: true });
    const laterInput = { ...input, requestId: randomUUID(), expenseId: secondExpense.id, paymentDate: "2026-10-21" };
    await assert.rejects(() => payExpense(db, "50", laterInput, today), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_cash_before_period");
    assert.equal((await settlementOverview(db, "50", secondAccount.id)).expected, "100.00");
    const ref = (await pg.query<{ date: string }>("SELECT (resolved_at AT TIME ZONE 'Africa/Cairo')::date::text AS date FROM finance.settlements WHERE id=$1::bigint", [settlement.id])).rows[0].date;
    const dateAtReference = { ...laterInput, paymentDate: ref };
    assert.equal((await payExpense(db, "50", dateAtReference, ref)).replayed, false);
    assert.equal((await payExpense(db, "50", dateAtReference, ref)).replayed, true);
    const afterSettlement = await settlementOverview(db, "50", secondAccount.id);
    assert.equal(afterSettlement.expenses, "10.00");
    assert.equal(afterSettlement.expected, "90.00");
    // Equality is deliberately permitted by the policy and cannot distinguish
    // a physical payment before versus after a settlement on the same day.
    // Read the real synthetic records as candidates, never a proven assignment.
    const inventory = await db.serializable(async tx => {
      await tx.query("SET TRANSACTION READ ONLY");
      await tx.query("SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
      return auditSyntheticHolderCheckpoints(tx, "1", "0", 100);
    });
    const second = inventory.rows.filter(row => row.expenseId === secondExpense.id);
    assert.ok(second.some(row => row.accountId === secondAccount.id && row.referenceType === "SETTLEMENT" && row.referenceId === settlement.id && row.dateSame && row.recordedAfter));
    assert.ok(second.some(row => row.accountId === secondAccount.id && row.referenceType === "OPENING"));

  } finally { await pg.close(); }
});
