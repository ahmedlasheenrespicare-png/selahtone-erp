/** Disposable synthetic database only: no production integration or historical inference. */
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
import { createCommerceSale, recordCommerceRefund, returnCommerceSale } from "../src/lib/commerce-operations";
import { confirmCashCount, openAccount, requestCashCount } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import type { FinanceDatabase } from "../src/lib/finance/types";
import { checkSyntheticRefundTiming } from "../prototypes/finance-refund-checkpoint/policy.test-only";
import { parseMoneyMovement } from "../src/lib/commerce-validation";
import { refundRequestIdentity } from "../src/lib/refund-request-identity";
import { actor } from "./helpers/commerce-actor";

const root = process.cwd();
const { PrismaClient: WasmClient } = createRequire(join(root, "package.json"))("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };

test("unknown and invalid timing never qualifies for ordinary refund", () => {
  for (const value of [undefined, null, "", "UNKNOWN", "BEFORE_REVIEWED_CHECKPOINT", "after", true, {}]) {
    assert.throws(() => checkSyntheticRefundTiming(value), /متوقف للمراجعة/);
  }
  assert.doesNotThrow(() => checkSyntheticRefundTiming("AFTER_REVIEWED_CHECKPOINT"));
});

test("synthetic cash refund rejects stale checkpoint and rolls back atomically", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-refund-checkpoint-"));
  let pg: PGlite | undefined; let client: PrismaClient | undefined;
  const previous = process.env.FINANCE_ENABLED; process.env.FINANCE_ENABLED = "true";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Test-2026!" }, stdio: "pipe", timeout: 60_000 });
    pg = new PGlite(dir); await pg.exec(readFileSync(join(root,"tests/fixtures/commerce-auth-sessions.sql"),"utf8")); await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(readFileSync(join(root, f), "utf8"));
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: work => client!.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "100", openingDate: today, counted: true }, today);
    const makeInvoice = async () => {
      const sale = await createCommerceSale(client!, actor(3n) , { requestId: randomUUID(), warehouseId: "1", customerName: "عميل اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "10", method: "CARD", lines: [{ productId: "4", quantity: "1", serialIds: [], expectedUnitPrice: "150", expectedTaxRateId: "3", expectedTaxKind: "VAT", expectedTaxRate: "14" }] });
      const line = await client!.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(sale.id) }, select: { id: true } });
      await returnCommerceSale(client!, actor(1n) , { requestId: randomUUID(), saleId: sale.id, cancel: false, accepted: true, lines: [{ saleLineId: line.id.toString(), quantity: "1", serialIds: [] }] });
      return sale.id;
    };
    const saleId = await makeInvoice();
    const input = { requestId: randomUUID(), saleId, amount: "6", method: "CASH", actuallyPaid: true, accountId: account.id, negativeAcknowledged: false };
    const review = { actorId: "1", branchId: "1", saleId, accountId: account.id, checkpointRef: "OPENING", afterCheckpoint: true, timing: "AFTER_REVIEWED_CHECKPOINT" as const };
    const snapshot = async () => (await pg!.query<{ refunds: number; moves: number; revision: string; sale_revision: number }>(`SELECT (SELECT count(*)::int FROM commerce_refunds WHERE request_id=$1::uuid) AS refunds,
      (SELECT count(*)::int FROM finance.movements WHERE source_id=$2::bigint) AS moves,
      (SELECT revision::text FROM finance.accounts WHERE id=$2::bigint) AS revision,
      (SELECT revision FROM commerce_sales WHERE id=$3::bigint) AS sale_revision`, [input.requestId, account.id, saleId])).rows[0];
    const before = await snapshot();
    for (const timing of [undefined, "BEFORE_REVIEWED_CHECKPOINT", "UNKNOWN"] as const) {
      await assert.rejects(() => recordCommerceRefund(client!, actor(1n) , { ...input, checkpointRef: "OPENING", timing }), /متوقف للمراجعة/);
      assert.deepEqual(await snapshot(), before);
    }
    const count = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: account.id, expectedBalance: "100", countedAmount: "100", reason: "جرد اصطناعي", actuallyCounted: true }, today);
    await confirmCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "اعتماد اصطناعي", stillCurrent: true });
    const afterCount = await snapshot();
    const body = { ...input, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
    await assert.rejects(() => recordCommerceRefund(client!, actor(1n) , body), /تغيّر آخر جرد/);
    assert.deepEqual(await snapshot(), afterCount);
    const reviewed = { ...body, checkpointRef: count.id };
    const saved = await recordCommerceRefund(client, actor(1n) , reviewed);
    const movement = (await pg.query<{ id: string; count_id: string | null; after_opening: boolean }>("SELECT id::text,after_cash_count_id::text AS count_id,after_opening FROM finance.movements WHERE external_ref=$1", [`refund:${saved.id}`])).rows[0];
    assert.equal(movement.count_id, count.id); assert.equal(movement.after_opening, false);
    const audit = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.audit_events WHERE entity_type='MOVEMENT' AND entity_id=$1::bigint AND action='REFUND' AND after_data->>'checkpointRef'=$2", [movement.id, count.id])).rows[0];
    assert.equal(audit.n, 1);
    const after = await snapshot();
    assert.deepEqual(await recordCommerceRefund(client, actor(1n) , reviewed), { id: saved.id, replayed: true });
    process.env.FINANCE_ENABLED = "false";
    assert.deepEqual(await recordCommerceRefund(client, actor(1n) , reviewed), { id: saved.id, replayed: true }, "a reviewed committed request still replays when finance is disabled");
    await assert.rejects(() => recordCommerceRefund(client!, actor(1n) , { ...reviewed, checkpointRef: "OPENING" }), /بيانات مختلفة/);
    process.env.FINANCE_ENABLED = "true";
    for (const changed of [{ ...reviewed, checkpointRef: "OPENING" }, { ...reviewed, timing: "UNKNOWN" }, { ...reviewed, amount: "5" }])
      await assert.rejects(() => recordCommerceRefund(client!, actor(1n) , changed), /بيانات مختلفة/);
    assert.deepEqual(await snapshot(), after);
    // Inject P2002 once per call, then let the recovery transaction read the
    // committed replay. A proxy that rejects EVERY $transaction would also
    // reject the fresh authorization/replay read inside P2002 recovery.
    const uniqueFailure = (): PrismaClient => {
      let injected = false;
      return new Proxy(client!, { get(target, prop) {
        if (prop === "$transaction") return (...args: unknown[]) => {
          if (!injected) { injected = true; throw Object.assign(new Error("synthetic unique conflict"), { code: "P2002" }); }
          const transaction = Reflect.get(target, prop, target) as (...a: unknown[]) => unknown;
          return transaction.apply(target, args);
        };
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      } }) as PrismaClient;
    };
    assert.deepEqual(await recordCommerceRefund(uniqueFailure(), actor(1n) , reviewed), { id: saved.id, replayed: true });
    process.env.FINANCE_ENABLED = "false";
    assert.deepEqual(await recordCommerceRefund(uniqueFailure(), actor(1n) , reviewed), { id: saved.id, replayed: true }, "injected P2002 must recognize reviewed replay after finance is disabled");
    process.env.FINANCE_ENABLED = "true";
    await assert.rejects(() => recordCommerceRefund(uniqueFailure(), actor(1n) , { ...reviewed, checkpointRef: "OPENING" }), /بيانات مختلفة/);
    assert.deepEqual(await snapshot(), after);
    // A new cash request cannot create an untracked refund while finance is
    // disabled, even through a direct service call or with made-up review data.
    const oldSale = await makeInvoice();
    const oldInput = { ...input, saleId: oldSale, requestId: randomUUID() };
    process.env.FINANCE_ENABLED = "false";
    for (const attempted of [oldInput, { ...oldInput, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" }])
      await assert.rejects(() => recordCommerceRefund(client!, actor(1n) , attempted), /متوقف للمراجعة عند تعطيل المالية/);
    assert.equal(await client.commerceRefund.count({ where: { requestId: oldInput.requestId } }), 0);
    // Insert a synthetic legacy row, without fabricating financial evidence.
    const parsedOld = parseMoneyMovement(oldInput, true); assert.ok(parsedOld.ok);
    const old = await client.commerceRefund.create({ data: { requestId: oldInput.requestId,
      requestHash: refundRequestIdentity(1n, parsedOld.value, oldInput).baseHash,
      saleId: BigInt(oldSale), amount: oldInput.amount, method: "CASH", createdById: 1n } });
    const oldResult = { id: old.id.toString(), replayed: true };
    assert.deepEqual(await recordCommerceRefund(client, actor(1n) , oldInput), oldResult);
    process.env.FINANCE_ENABLED = "true";
    assert.deepEqual(await recordCommerceRefund(client, actor(1n) , oldInput), oldResult);
    assert.deepEqual(await recordCommerceRefund(uniqueFailure(), actor(1n) , oldInput), oldResult);
    await assert.rejects(() => recordCommerceRefund(client!, actor(1n) , { ...oldInput, checkpointRef: count.id, timing: "AFTER_REVIEWED_CHECKPOINT" }), /بيانات مختلفة/);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1", [`refund:${old.id.toString()}`])).rows[0].n, 0);
    const noAccountSale = await makeInvoice();
    const legacyNoAccount = { ...input, saleId: noAccountSale, requestId: randomUUID(), accountId: null };
    const legacyParsed = parseMoneyMovement(legacyNoAccount, true, { allowMissingCashAccountForReplay: true }); assert.ok(legacyParsed.ok);
    const legacyRow = await client.commerceRefund.create({ data: { requestId: legacyNoAccount.requestId, requestHash: refundRequestIdentity(1n, legacyParsed.value, legacyNoAccount).baseHash, saleId: BigInt(noAccountSale), amount: legacyNoAccount.amount, method: "CASH", createdById: 1n } });
    assert.deepEqual(await recordCommerceRefund(client, actor(1n) , legacyNoAccount), { id: legacyRow.id.toString(), replayed: true });
    assert.deepEqual(await recordCommerceRefund(uniqueFailure(), actor(1n) , legacyNoAccount), { id: legacyRow.id.toString(), replayed: true });
    await assert.rejects(() => recordCommerceRefund(client!, actor(1n) , { ...legacyNoAccount, requestId: randomUUID() }), /راجع رد المبلغ/);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1", [`refund:${legacyRow.id.toString()}`])).rows[0].n, 0);
  } finally {
    if (previous === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previous;
    if (client) await client.$disconnect(); else if (pg) await pg.close(); rmSync(dir, { recursive: true, force: true });
  }
});
