import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticCounts } from "../prototypes/finance-count-audit/audit.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("synthetic count audit inventories ambiguous references and movement evidence without writes", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(read(f));
    await pg.exec(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES
      (1,'CUSTODY',3,100,CURRENT_DATE,1),(1,'VAULT',NULL,0,CURRENT_DATE,1),(2,'VAULT',NULL,0,CURRENT_DATE,1);
      INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,requested_by,counter_id)
      VALUES (1,0,0,0,0,CURRENT_DATE,'طلب لم يعد',1,1,NULL), (2,10,0,10,0,CURRENT_DATE,'جرى تعديله قبل الاعتماد',1,NULL,NULL), (3,0,0,0,0,CURRENT_DATE,'فرع آخر',1,NULL,NULL);
      INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,status,resolved_by,resolved_at,resolution_reason)
      VALUES (1,100,100,0,0,CURRENT_DATE,'مطابق',1,'CONFIRMED',1,now(),'تأكيد'),
      (1,110,100,10,0,CURRENT_DATE,'زيادة',1,'CONFIRMED',1,now(),'تأكيد'),
      (1,90,100,-10,0,CURRENT_DATE,'حركة خاطئة',1,'CONFIRMED',1,now(),'تأكيد'),
      (1,95,100,-5,0,CURRENT_DATE,'حركة مفقودة',1,'CONFIRMED',1,now(),'تأكيد'),
      (1,100,100,0,0,CURRENT_DATE,'مطابق مع حركة',1,'CONFIRMED',1,now(),'تأكيد'),
      (1,110,100,10,0,CURRENT_DATE,'فرع حركة خاطئ',1,'CONFIRMED',1,now(),'تأكيد'),
      (1,110,100,10,0,CURRENT_DATE,'حساب حركة خاطئ',1,'CONFIRMED',1,now(),'تأكيد'),
      (1,110,100,10,0,CURRENT_DATE,'مبلغ حركة خاطئ',1,'CONFIRMED',1,now(),'تأكيد');
      INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,requested_by,status,resolved_by,resolved_at,resolution_reason)
      VALUES (1,0,0,0,0,CURRENT_DATE,'تأكيد قديم دون إقرار',1,1,'CONFIRMED',1,now(),'تأكيد');
      INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,cash_count_id,actor_id) VALUES
      ('COUNT_ADJUSTMENT',1,NULL,2,10,2,1),('COUNT_ADJUSTMENT',1,NULL,1,10,5,1),
      ('COUNT_ADJUSTMENT',1,NULL,1,10,6,1),('COUNT_ADJUSTMENT',1,NULL,1,1,8,1),
      ('COUNT_ADJUSTMENT',2,NULL,1,10,9,1),('COUNT_ADJUSTMENT',1,NULL,2,10,10,1),('COUNT_ADJUSTMENT',1,NULL,1,9,11,1);
      INSERT INTO finance.audit_events(entity_type,entity_id,action,actor_id,after_data) VALUES ('CASH_COUNT',5,'CREATE',1,'{"bookBalance":"100.00"}'::jsonb);`);
    const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, args: unknown[] = []) => ({ rows: (await pg.query(sql, args)).rows as T[] }) };
    const snapshot = async () => (await pg.query(`SELECT (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM finance.cash_counts c)::text AS counts,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM finance.movements m)::text AS movements,
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM finance.audit_events e)::text AS audit`)).rows[0];
    const before = await snapshot();
    const rows = await auditSyntheticCounts(port, "1");
    assert.deepEqual(rows.map(r => [r.countId,r.findings]), [
      ["1",["AWAITING_HOLDER"]],["2",["MOVEMENT_ON_UNCONFIRMED"]],["4",[]],
      ["5",[]],["6",["ADJUSTMENT_MISMATCH"]],["7",["MISSING_ADJUSTMENT"]],["8",["UNEXPECTED_ADJUSTMENT","ADJUSTMENT_MISMATCH"]],
      ["9",["ADJUSTMENT_MISMATCH"]],["10",["ADJUSTMENT_MISMATCH"]],["11",["ADJUSTMENT_MISMATCH"]],["12",["CONFIRMED_WITHOUT_HOLDER"]]]);
    assert.equal(rows.find(r => r.countId === "5")?.referenceEvidence, "BOOK_BALANCE_AUDIT_PRESENT");
    assert.equal(rows.find(r => r.countId === "4")?.referenceEvidence, "REFERENCE_UNPROVEN");
    assert.equal(rows.find(r => r.countId === "5")?.movementDirection, "IN");
    assert.equal((await auditSyntheticCounts(port, "2")).length, 1);
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(() => auditSyntheticCounts(port, "1 OR true"), /invalid synthetic branch/);
  } finally { await pg.close(); }
});
