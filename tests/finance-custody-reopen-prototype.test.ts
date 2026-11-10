/** Synthetic index experiment only. Does not modify or migrate production data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { recordCommerceCollection } from "../src/lib/commerce-operations";
import { approveExpense, closeAccount, confirmSettlement, createExpense, openAccount, payExpense, requestSettlement, settlementOverview } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import type { FinanceDatabase } from "../src/lib/finance/types";
import { testCollectionService, testHolderPaymentService } from "../prototypes/finance-collection-policy/runtime-adapters.test-only";
import { reviewTestPeriod } from "../prototypes/finance-collection-policy/period.test-only";

const root = process.cwd(), read = (f: string) => readFileSync(join(root, f), "utf8");
const require = createRequire(join(root, "package.json"));
const { PrismaClient: WasmClient } = require("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };

test("reopening custody candidate: index-only experiment with real interim services", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-reopen-prototype-"));
  let pg: PGlite | undefined, client: PrismaClient | undefined;
  const previous = process.env.FINANCE_ENABLED; process.env.FINANCE_ENABLED = "true";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Test-2026!" }, stdio: "pipe", timeout: 60_000 });
    pg = new PGlite(dir);
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(read(f));
    await assert.rejects(() => pg!.exec(read("prototypes/finance-custody-reopen/index.test-only.sql")), /explicit opt-in/);
    await pg.exec("SET selahtone.custody_reopen_test_only='yes'");
    await pg.exec(read("prototypes/finance-custody-reopen/index.test-only.sql"));
    await pg.exec("SET selahtone.collection_policy_test_only='yes'");
    await pg.exec(read("prototypes/finance-collection-policy/allocations.test-only.sql"));
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: work => client!.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    await pg.exec("UPDATE commerce_sales SET created_by_id=3 WHERE id=2; UPDATE commerce_collections SET created_at=now()-interval '10 days'");
    await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "100", openingDate: today, counted: true }, today);
    const opening = () => ({ requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: today, counted: true });
    const oldInput = opening(); const old = await openAccount(db, "1", oldInput, today);
    await assert.rejects(() => openAccount(db, "1", opening(), today), /مسجّل بالفعل/);
    const firstCash = { requestId: randomUUID(), saleId: "2", amount: "5", method: "CASH", actuallyPaid: false };
    await recordCommerceCollection(client, 3n, firstCash);
    const unsettled = { requestId: randomUUID(), accountId: old.id, reason: "عهدة اصطناعية" };
    await assert.rejects(() => closeAccount(db, "1", unsettled), /تحصيلات أو مصروفات غير مسوّاة/);
    const request = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: old.id, expectedBalance: "0", countedAmount: "5", reason: "تسوية اصطناعية", actuallyCounted: true });
    await confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: request.id, expectedBalance: "0", transferAmount: "5", transferDirection: "TO_VAULT", reason: "اعتماد اصطناعي", actuallyTransferred: true });
    await closeAccount(db, "1", unsettled);
    const newerInput = opening(); const newer = await openAccount(db, "1", newerInput, today);
    assert.notEqual(newer.id, old.id);
    assert.equal((await openAccount(db, "1", oldInput, today)).id, old.id, "replay refers to the original closed account");
    assert.equal((await openAccount(db, "1", newerInput, today)).id, newer.id);
    assert.equal((await closeAccount(db, "1", unsettled)).replayed, true);
    assert.equal((await recordCommerceCollection(client, 3n, firstCash)).replayed, true);
    assert.equal((await settlementOverview(db, "3")).account?.id, newer.id);
    assert.equal((await settlementOverview(db, "3")).sales, "0.00", "old settled cash should not enter the new normal-time period");
    const nextCash = { ...firstCash, requestId: randomUUID(), amount: "2" };
    await recordCommerceCollection(testCollectionService(client, "3"), 3n, nextCash);
    assert.equal((await settlementOverview(db, "3")).sales, "2.00");
    const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "1", expenseDate: today, description: "مصروف عهدة بديلة اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    const payment = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    await payExpense(testHolderPaymentService(db, "3"), "3", payment, today);
    assert.equal((await settlementOverview(db, "3")).expenses, "1.00");
    assert.equal((await payExpense(testHolderPaymentService(db, "3"), "3", payment, today)).replayed, true);
    const assigned = await db.serializable(tx => reviewTestPeriod(tx, newer.id));
    assert.deepEqual(assigned.collections.map(c => c.amount), ["2.00"]);
    assert.deepEqual(assigned.payments.map(p => p.amount), ["1.00"]);

    // Defensive behavior if an explicitly corrupted disposable schema contains
    // two open custodies: neither service may guess which account owns cash.
    await pg.exec("DROP INDEX finance.finance_custody_open_per_holder_test_only");
    const duplicate = (await pg.query<{ id: string }>(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
      VALUES(1,'CUSTODY',3,0,$1::date,1) RETURNING id::text`, [today])).rows[0].id;
    const secondExpense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "1", expenseDate: today, description: "اختبار عهدتين مفتوحتين" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: secondExpense.id, expectedRevision: "1" });
    await assert.rejects(() => recordCommerceCollection(client!, 3n, { ...nextCash, requestId: randomUUID() }), /يلزم وجود عهدة مفتوحة للمسجّل/);
    await assert.rejects(() => payExpense(db, "3", { ...payment, requestId: randomUUID(), expenseId: secondExpense.id }, today), /يلزم وجود عهدة مفتوحة للمسجّل/);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.expenses WHERE id=$1::bigint", [secondExpense.id])).rows[0].status, "APPROVED");
    await pg.query("DELETE FROM finance.accounts WHERE id=$1::bigint", [duplicate]);
    await pg.exec("CREATE UNIQUE INDEX finance_custody_open_per_holder_test_only ON finance.accounts(branch_id,holder_id) WHERE kind='CUSTODY' AND closed_at IS NULL");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts WHERE kind='CUSTODY' AND holder_id=3 AND closed_at IS NULL")).rows[0].n, 1);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts WHERE kind='CUSTODY' AND holder_id=3 AND closed_at IS NOT NULL")).rows[0].n, 1);
  } finally {
    if (previous === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previous;
    if (client) await client.$disconnect(); else if (pg) await pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
