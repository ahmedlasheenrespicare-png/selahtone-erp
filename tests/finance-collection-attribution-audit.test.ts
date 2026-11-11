/** Characterizes a known defect using the real commerce service. Disposable data only. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
import { createCatalogSale } from "../src/lib/catalog-sales";
import { parseMoneyMovement } from "../src/lib/commerce-validation";
import { closeAccount, confirmSettlement, openAccount, requestSettlement, settlementOverview } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import { CUSTODY_EXPECTATION_SQL } from "../src/lib/finance/custody-summary-sql";
import type { FinanceDatabase } from "../src/lib/finance/types";
import { actor } from "./helpers/commerce-actor";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const { PrismaClient: WasmClient } = require("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };

test("cash interim guards reject on-behalf and closed custody; legacy attribution remains", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-collection-audit-"));
  let pg: PGlite | undefined;
  let client: PrismaClient | undefined;
  const previousFinance = process.env.FINANCE_ENABLED; process.env.FINANCE_ENABLED = "true";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], {
      cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Access-Test-2026!" }, stdio: "pipe", timeout: 60_000,
    });
    pg = new PGlite(dir); await pg.exec(readFileSync(join(root,"tests/fixtures/commerce-auth-sessions.sql"),"utf8"));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(readFileSync(join(root, file), "utf8"));
    // Demo seed uses Cairo wall-clock hours that can be in the future.
    // Place unrelated seed cash before these synthetic accounts open.
    await pg.exec("UPDATE commerce_collections SET created_at=now()-interval '2 days' WHERE method='CASH'");
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: (work) => client!.$transaction((tx) => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    // Invoice 2 belongs to branch 1, was created by the manager, and has an outstanding balance.
    const sale = await client.commerceSale.findUniqueOrThrow({ where: { id: 2n } });
    assert.equal(sale.createdById, 1n); assert.equal(sale.branchId, 1n);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: today, counted: true }, today);
    const first = { requestId: randomUUID(), saleId: "2", amount: "37", method: "CASH", actuallyPaid: false };
    const countBefore = await client.commerceCollection.count();
    await assert.rejects(() => recordCommerceCollection(client!, actor(3n) , first), /التحصيل النقدي بالنيابة عن منشئ الفاتورة متوقف مؤقتًا/);
    assert.equal(await client.commerceCollection.count(), countBefore, "denial must not save a collection");
    const noncash = { ...first, requestId: randomUUID(), amount: "2", method: "CARD" };
    assert.equal((await recordCommerceCollection(client, actor(3n) , noncash)).replayed, false);
    assert.equal((await recordCommerceCollection(client, actor(3n) , noncash)).replayed, true);
    const ownCash = { ...first, requestId: randomUUID(), amount: "3" };
    await assert.rejects(() => recordCommerceCollection(client!, actor(1n) , ownCash), /يلزم وجود عهدة مفتوحة/);
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=1");
    const managerAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "1", openingAmount: "0", openingDate: today, counted: true }, today);
    // Inject a failure after the real collection insert AND custody revision
    // update have both run, while still inside the service transaction.
    let reachedAfterRevision = false;
    const failingClient = new Proxy(client, { get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return async (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
        const wrapped = new Proxy(tx, { get(obj, prop, recv) {
          if (prop !== "$queryRawUnsafe") return Reflect.get(obj, prop, recv);
          return async (sql: string, ...params: unknown[]) => {
            const result = await tx.$queryRawUnsafe(sql, ...params);
            if (sql.includes("UPDATE finance.accounts SET revision=revision+1")) {
              reachedAfterRevision = true;
              throw new Error("synthetic failure after custody revision");
            }
            return result;
          };
        }});
        return work(wrapped);
      }, options as never);
    }}) as PrismaClient;
    const snapshot = async () => (await pg!.query<{ account_revision: string; sale_revision: number; collections: number; movements: number }>(`SELECT
      (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS account_revision,
      (SELECT revision FROM commerce_sales WHERE id=2) AS sale_revision,
      (SELECT count(*)::int FROM commerce_collections) AS collections,
      (SELECT count(*)::int FROM finance.movements) AS movements`, [managerAccount.id])).rows[0];
    const beforeFailure = await snapshot();
    await assert.rejects(() => recordCommerceCollection(failingClient, actor(1n) , ownCash), /synthetic failure after custody revision/);
    assert.equal(reachedAfterRevision, true);
    assert.deepEqual(await snapshot(), beforeFailure, "failed transaction must roll back collection, both revisions and movements");
    assert.equal((await recordCommerceCollection(client, actor(1n) , ownCash)).replayed, false);
    const committed = await snapshot();
    assert.equal(BigInt(committed.account_revision), BigInt(beforeFailure.account_revision) + 1n);
    assert.equal(Number(committed.sale_revision), Number(beforeFailure.sale_revision) + 1);
    assert.equal(committed.collections, beforeFailure.collections + 1);
    assert.equal(committed.movements, beforeFailure.movements, "collection does not post an immediate cash movement");
    assert.equal((await recordCommerceCollection(client, actor(1n) , ownCash)).replayed, true);
    assert.deepEqual(await snapshot(), committed, "replay does not bump revisions or create another record");
    // Model a legacy receipt from before the guard, not a new permitted write.
    const legacyInput = { ...first, requestId: randomUUID() };
    const parsed = parseMoneyMovement(legacyInput, false); assert.ok(parsed.ok);
    const requestHash = createHash("sha256").update(JSON.stringify({ actorId: "3", type: "COLLECTION", ...parsed.value })).digest("hex");
    const legacy = await client.commerceCollection.create({ data: { requestId: legacyInput.requestId, requestHash, saleId: 2n, amount: "37", method: "CASH", isInitial: false, createdById: 3n } });
    assert.equal(legacy.createdById, 3n);
    assert.equal((await recordCommerceCollection(client, actor(3n) , legacyInput)).replayed, true, "an already saved legacy request must remain replayable without another write");
    await assert.rejects(() => recordCommerceCollection(client!, actor(3n) , { ...legacyInput, amount: "38" }), /بيانات مختلفة/);
    const overview = await settlementOverview(db, "3", account.id);
    assert.equal(overview.sales, "0.00", "legacy cash is still omitted when invoice creator differs");
    assert.equal(overview.sourceRecorderMismatch,true,"the recorder receives a nonblocking warning about the mismatch");
    const summaryFlags = async (branch: string) => (await pg!.query<{ id: string; mismatch: boolean }>(
      `SELECT id::text AS id,source_recorder_mismatch AS mismatch FROM (${CUSTODY_EXPECTATION_SQL}) x ORDER BY id`, [branch])).rows;
    const scoped = await summaryFlags("1");
    assert.equal(scoped.find(x => x.id === account.id)?.mismatch, true, "aggregate uses the same recorder hint");
    assert.equal(scoped.find(x => x.id === managerAccount.id)?.mismatch, true, "invoice creator side is included");
    assert.deepEqual(await summaryFlags("2"), [], "branch filter excludes other-branch hints");
    assert.equal(overview.account?.balance, "0.00");
    const movementCount = async () => Number((await pg!.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n);
    assert.equal(await movementCount(), 0, "real collection path still does not post the cash hook");
    // Exercise the initial cash collection in the actual catalog-sale path too.
    // The injected error happens after the invoice, line, collection and custody
    // revision have been written, but before the enclosing transaction commits.
    const category = (await pg.query<{ id: number }>("INSERT INTO sales_item_categories(code,name_ar) VALUES ('AUDIT_CASH','فئة اصطناعية') RETURNING id")).rows[0].id;
    const item = (await pg.query<{ id: number }>("INSERT INTO sales_item_types(category_id,name_ar) VALUES ($1,'صنف اصطناعي') RETURNING id", [category])).rows[0].id;
    const initial = { requestId: randomUUID(), branchId: "1", customerName: "عميل اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "7", method: "CASH", lines: [{ typeId: String(item), quantity: "1", unitPrice: "100", details: [] }] };
    const saleSnapshot = async () => (await pg!.query<{ account_revision: string; sales: number; lines: number; collections: number; movements: number }>(`SELECT
      (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS account_revision,
      (SELECT count(*)::int FROM commerce_sales) AS sales,
      (SELECT count(*)::int FROM commerce_sale_lines) AS lines,
      (SELECT count(*)::int FROM commerce_collections) AS collections,
      (SELECT count(*)::int FROM finance.movements) AS movements`, [account.id])).rows[0];
    const saleBefore = await saleSnapshot();
    reachedAfterRevision = false;
    await assert.rejects(() => createCatalogSale(failingClient, actor(3n) , initial), /synthetic failure after custody revision/);
    assert.equal(reachedAfterRevision, true);
    assert.deepEqual(await saleSnapshot(), saleBefore, "the whole initial sale and revision must roll back");
    assert.equal((await createCatalogSale(client, actor(3n) , initial)).replayed, false);
    const saleCommitted = await saleSnapshot();
    assert.equal(saleCommitted.sales, saleBefore.sales + 1);
    assert.equal(saleCommitted.lines, saleBefore.lines + 1);
    assert.equal(saleCommitted.collections, saleBefore.collections + 1);
    assert.equal(BigInt(saleCommitted.account_revision), BigInt(saleBefore.account_revision) + 1n);
    assert.equal(saleCommitted.movements, saleBefore.movements);
    assert.equal((await createCatalogSale(client, actor(3n) , initial)).replayed, true);
    assert.deepEqual(await saleSnapshot(), saleCommitted, "initial-sale replay must not duplicate records or revision");
    // The successful synthetic sale now belongs to the current formula; settle
    // before closing rather than modifying/removing the recorded sale.
    await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "0", openingDate: today, counted: true }, today);
    const settlement = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: account.id, countedAmount: "0", expectedBalance: "0", reason: "جرد اصطناعي", actuallyCounted: true });
    await confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: settlement.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "مراجعة اصطناعية", actuallyTransferred: true });
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: account.id, reason: "اختبار اصطناعي" });
    assert.equal((await settlementOverview(db, "3")).account, null);
    // The actual catalog sale and later collection now refuse cash for a closed
    // custody; noncash remains available and does not create a cash movement.
    const closedInitial = { ...initial, requestId: randomUUID() };
    const salesBefore = await client.commerceSale.count();
    await assert.rejects(() => createCatalogSale(client!, actor(3n) , closedInitial), /يلزم وجود عهدة مفتوحة/);
    assert.equal(await client.commerceSale.count(), salesBefore);
    const noncashSale = { ...initial, requestId: randomUUID(), method: "CARD" };
    const newSale = await createCatalogSale(client, actor(3n) , noncashSale);
    assert.equal(newSale.replayed, false);
    assert.equal((await createCatalogSale(client, actor(3n) , noncashSale)).replayed, true);
    const later = { requestId: randomUUID(), saleId: newSale.id, amount: "13", method: "CASH", actuallyPaid: false };
    await assert.rejects(() => recordCommerceCollection(client!, actor(3n) , later), /يلزم وجود عهدة مفتوحة/);
    assert.equal(await movementCount(), 0);
    // The reverse error: a manager collecting on a staff-created invoice is
    // currently added to that staff member's period, regardless of who collected.
    await pg.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 4,1,'CS_AGENT','موظف اصطناعي','other-synthetic@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    await pg.exec("UPDATE commerce_sales SET created_by_id=4,total=5800 WHERE id=4");
    const other = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "4", openingAmount: "0", openingDate: today, counted: true }, today);
    await assert.rejects(() => recordCommerceCollection(client!, actor(1n) , { requestId: randomUUID(), saleId: "4", amount: "19", method: "CASH", actuallyPaid: false }), /التحصيل النقدي بالنيابة/);
    await client.commerceCollection.create({ data: { requestId: randomUUID(), requestHash: "b".repeat(64), saleId: 4n, amount: "19", method: "CASH", isInitial: false, createdById: 1n } });
    const creatorOverview=await settlementOverview(db, "4", other.id);
    assert.equal(creatorOverview.sales, "19.00", "legacy manager collection is still attributed to invoice creator");
    assert.equal(creatorOverview.sourceRecorderMismatch,true,"the invoice creator receives the same narrow warning");
    assert.equal(await movementCount(), 0);
  } finally {
    if (previousFinance === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previousFinance;
    if (client) await client.$disconnect();
    else if (pg) await pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
