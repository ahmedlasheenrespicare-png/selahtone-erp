/** Synthetic read-only receipt diagnostic; no external DB or application hook. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditTestOnlyReceipts } from "../prototypes/finance-cutover-period-audit/receipt-audit.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const fingerprint = (collections: string[][], payments: string[][]) => createHash("sha256").update(JSON.stringify({ collections, payments })).digest("hex");

test("read-only synthetic receipt audit detects missing evidence and inconsistent memberships", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql","tests/fixtures/finance-legacy-categories.sql","tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; ALTER TABLE public.commerce_collections ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'; SET selahtone.collection_policy_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql","prototypes/finance-collection-policy/allocations.test-only.sql"]) await pg.exec(read(f));
    await pg.exec(`INSERT INTO public.users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES (2,'CS_AGENT','موظف اصطناعي','receipt-second@example.test','fixture','ACTIVE',false);
      INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES (1,'CUSTODY',3,0,'2026-01-01',1),(2,'CUSTODY',5,0,'2026-01-01',1);
      INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,status,resolved_by,resolved_at,resolution_reason,transfer_amount,transfer_direction)
        VALUES (1,1,3,0,0,10,4,6,0,0,'اصطناعي','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,1,3,0,0,10,0,10,0,0,'اصطناعي','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,1,3,0,0,5,0,5,0,0,'اصطناعي','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,1,3,0,0,0,0,0,0,0,'بلا إيصال','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,1,3,0,0,3,0,3,0,0,'فرع خاطئ','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,1,3,0,0,2,2,0,0,0,'إيصال تالف','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT');
      INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason) VALUES (1,1,3,0,0,0,0,0,0,0,'مفتوحة');
      INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,status,resolved_by,resolved_at,resolution_reason,transfer_amount,transfer_direction)
        VALUES (2,2,5,0,0,0,0,0,0,0,'حساب إيصال خاطئ','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,1,3,0,0,0,0,0,0,0,'فارغة','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (2,2,5,0,0,9,0,9,0,0,'إسناد خاطئ بلا إيصال','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,2,3,0,0,0,0,0,0,0,'فرع تسوية خاطئ','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT'),
               (1,1,3,0,0,10,0,10,0,0,'مبالغ متعاكسة','CONFIRMED',1,now(),'اعتماد',0,'TO_VAULT');
      INSERT INTO commerce_sales(branch_id,created_by_id) VALUES (1,3);
      INSERT INTO commerce_collections(sale_id,amount,method,created_by_id) VALUES (1,10,'CASH',3),(1,5,'CASH',3),(1,5,'CASH',3),(1,5,'CASH',3),(1,3,'CASH',3),(1,2,'CASH',3),(1,9,'CASH',3),(1,5,'CASH',3),(1,5,'CASH',3);
      INSERT INTO finance.collection_allocations_test_only(collection_id,account_id,treatment,assigned_by,settlement_id) VALUES
        (1,1,'CUSTODY_PENDING',3,1),(2,1,'CUSTODY_PENDING',3,2),(3,1,'CUSTODY_PENDING',3,2),(4,1,'CUSTODY_PENDING',3,3),(5,2,'CUSTODY_PENDING',3,5),(6,1,'CUSTODY_PENDING',3,6),(7,1,'CUSTODY_PENDING',3,10),(8,1,'CUSTODY_PENDING',3,12),(9,1,'CUSTODY_PENDING',3,12);
      INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at) VALUES
        (1,1,'تجريبي',4,'2026-01-01','تجريبي','PAID',3,1,now()),(1,1,'تجريبي',2,'2026-01-01','تجريبي','PAID',1,1,now());
      INSERT INTO finance.payments(expense_id,amount,method,payment_date,recorded_by,actually_paid,source) VALUES
        (1,4,'CASH','2026-01-01',3,true,'HOLDER_CASH'),(2,2,'CASH','2026-01-01',1,true,'HOLDER_CASH');
      INSERT INTO finance.holder_payment_allocations_test_only(payment_id,account_id,assigned_by,settlement_id) VALUES (1,1,3,1),(2,1,1,6);`);
    async function receipt(settlement: number, account: number, collections: unknown, payments: unknown, hash: string, sales: string, expenses: string) {
      await pg.query(`INSERT INTO finance.settlement_allocation_receipts_test_only(settlement_id,account_id,collection_ids,payment_ids,snapshot_hash,sales_total,expenses_total) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::numeric,$7::numeric)`, [settlement,account,JSON.stringify(collections),JSON.stringify(payments),hash,sales,expenses]);
    }
    await receipt(1,1,["1"],["1"],fingerprint([["1","10.00"]],[["1","4.00"]]),"10","4");
    await receipt(2,1,["2","4"],[],fingerprint([["2","5.00"],["4","5.00"]],[]),"10","0");
    await receipt(3,1,["4"],[],fingerprint([["4","5.00"]],[]),"5","0");
    await receipt(5,1,["5"],[],fingerprint([["5","3.00"]],[]),"3","0");
    await receipt(6,1,["6","6"],["2"],fingerprint([["6","2.00"]],[["2","2.00"]]),"999","2");
    await receipt(7,1,[],[],fingerprint([],[]),"0","0");
    await receipt(8,1,[],[],fingerprint([],[]),"0","0");
    await receipt(9,1,[],[],fingerprint([],[]),"0","0");
    await receipt(11,1,[],[],fingerprint([],[]),"0","0");
    await receipt(12,1,["8","9"],[],fingerprint([["8","5.00"],["9","5.00"]],[]),"10","0");
    // Simulate source mutation after the synthetic receipt was created.
    await pg.exec("UPDATE commerce_collections SET amount=6 WHERE id=4");
    const port = (tx: { query: (q: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): FinanceTransaction => ({ query: async <T extends Record<string,unknown>>(q: string,p: unknown[] = []) => ({ rows: (await tx.query(q,p)).rows as T[] }) });
    const run = (id: string, mode = "REPEATABLE READ READ ONLY") => pg.transaction(async tx => { await tx.query(`SET TRANSACTION ISOLATION LEVEL ${mode}`); return auditTestOnlyReceipts(port(tx),id); });
    await assert.rejects(() => run("1"), /explicit opt-in/);
    await pg.exec("SET selahtone.cutover_period_audit_test_only='yes'");
    await assert.rejects(() => run("1", "READ COMMITTED READ ONLY"), /read-only repeatable snapshot/);
    await assert.rejects(() => run("1", "REPEATABLE READ READ WRITE"), /read-only repeatable snapshot/);
    const snapshot = async () => Promise.all(["finance.accounts","finance.settlements","finance.collection_allocations_test_only","finance.holder_payment_allocations_test_only","finance.settlement_allocation_receipts_test_only","finance.movements","public.commerce_collections","finance.payments"].map(async table => (await pg.query<{ data: string }>(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text AS data FROM ${table} t`)).rows[0].data));
    const before = await snapshot();
    const report = await run("1"), entry = (id: string) => { const value = report.reviews.find(row => row.settlementId === id); assert.ok(value, id); return value; };
    assert.deepEqual(report.confirmedWithoutReceipt,["4"]);
    assert.deepEqual(report.linkedWithoutReceipt,[{ settlementId: "10", accountId: "2", status: "CONFIRMED" }]);
    assert.deepEqual(entry("1").issues, []);
    assert.deepEqual(entry("1").collections.map(x => x.id),["1"]); assert.deepEqual(entry("1").payments.map(x => x.id),["1"]);
    assert.deepEqual(entry("2").issues,["collection_membership_mismatch","snapshot_mismatch"],"same total cannot establish the same IDs");
    assert.deepEqual(entry("3").issues,["snapshot_mismatch","attached_total_mismatch"]);
    assert.deepEqual(entry("5").issues,["invalid_collection_allocation"]);
    assert.deepEqual(entry("6").issues,["invalid_collection_ids","invalid_payment_allocation","receipt_total_mismatch"]);
    assert.deepEqual(entry("7").issues,["receipt_on_unconfirmed"]);
    assert.deepEqual(entry("8").issues,["receipt_account_mismatch"]);
    assert.deepEqual(entry("9").issues,[],"explicit empty receipt is a valid synthetic shape, not historical proof");
    assert.deepEqual(entry("11").issues,["settlement_scope_mismatch"]);
    assert.deepEqual(entry("12").issues,[]);
    assert.deepEqual(await snapshot(),before,"audit must not change any row");
    // Exercise malformed payment JSON and a valid-but-wrong payment ID on the
    // disposable fixture; the diagnostic must not repair either corruption.
    for (const [json, issue] of [["[\"2\",\"2\"]", "invalid_payment_ids"], ["[\"1\"]", "payment_membership_mismatch"], ["null", "invalid_payment_ids"]] as const) {
      await pg.query("UPDATE finance.settlement_allocation_receipts_test_only SET payment_ids=$1::jsonb WHERE settlement_id=6", [json]);
      const modified = await snapshot();
      const result = await run("1");
      assert.ok(result.reviews.find(row => row.settlementId === "6")?.issues.includes(issue), issue);
      assert.deepEqual(await snapshot(), modified, "audit does not repair intentionally malformed fixture");
    }
    await pg.exec(`UPDATE finance.settlement_allocation_receipts_test_only SET payment_ids='["2"]'::jsonb WHERE settlement_id=6`);
    assert.deepEqual(await snapshot(),before);
    // The hash alone ignores recorder changes; the diagnostic's independent
    // source-consistency check still reports this particular synthetic drift.
    await pg.exec("UPDATE commerce_collections SET created_by_id=1 WHERE id=1");
    const recorderChanged = await snapshot();
    assert.deepEqual((await run("1")).reviews.find(row => row.settlementId === "1")?.issues, ["invalid_collection_allocation"]);
    assert.deepEqual(await snapshot(), recorderChanged, "read-only audit must not repair the recorder");
    await pg.exec("UPDATE commerce_collections SET created_by_id=3 WHERE id=1");
    assert.deepEqual(await snapshot(), before);
    // Equal total and identical IDs still conceal offsetting amount changes;
    // only the recorded fingerprint flags this fixture.
    await pg.exec("UPDATE commerce_collections SET amount=CASE WHEN id=8 THEN 6 ELSE 4 END WHERE id IN (8,9)");
    const changed = await snapshot();
    assert.deepEqual((await run("1")).reviews.find(row => row.settlementId === "12")?.issues,["snapshot_mismatch"]);
    assert.deepEqual(await snapshot(),changed);
    // A writer able to alter both the source and the unauthenticated receipt
    // can recompute the hash. This deliberately demonstrates a blind spot, not
    // a validation strategy or a claim about actual data.
    await pg.query("UPDATE finance.settlement_allocation_receipts_test_only SET snapshot_hash=$1 WHERE settlement_id=12", [fingerprint([["8","6.00"],["9","4.00"]],[])]);
    const rewritten = await snapshot();
    assert.deepEqual((await run("1")).reviews.find(row => row.settlementId === "12")?.issues, [], "a rewritten fingerprint can hide coordinated offsetting source changes");
    assert.deepEqual(await snapshot(), rewritten, "the diagnostic must remain read-only even for a misleadingly consistent receipt");
    await pg.query("UPDATE finance.settlement_allocation_receipts_test_only SET snapshot_hash=$1 WHERE settlement_id=12", [fingerprint([["8","5.00"],["9","5.00"]],[])]);
    await pg.exec("UPDATE commerce_collections SET amount=5 WHERE id IN (8,9)");
    assert.deepEqual(await snapshot(),before);
    const other = await run("2");
    assert.deepEqual(other.confirmedWithoutReceipt,["10"]);
    assert.deepEqual(other.linkedWithoutReceipt,[]);
    assert.ok(other.reviews.some(row => row.settlementId === "5" && row.issues.includes("invalid_collection_allocation")), "wrong-account assignment is visible from both accounts");
    assert.ok(other.reviews.some(row => row.settlementId === "8" && row.issues.includes("receipt_account_mismatch")));
    await assert.rejects(() => run("1 OR 1=1"),/invalid synthetic account id/);
    await assert.rejects(() => run("999"),/synthetic custody not found/);
    await pg.transaction(async tx => { await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY"); await assert.rejects(() => tx.query("DELETE FROM finance.settlements"), /read-only/i); });
  } finally { await pg.close(); }
});
