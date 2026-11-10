import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticRefunds } from "../prototypes/finance-refund-audit/audit.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("synthetic refund evidence audit reports uncertainty and inconsistencies without writes", { timeout: 120_000 }, async () => {
  const pg = new PGlite(); const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
    await pg.exec(`CREATE TABLE public.commerce_refunds(id bigint PRIMARY KEY,sale_id bigint NOT NULL REFERENCES public.commerce_sales(id),amount numeric(14,2) NOT NULL,method text NOT NULL);
      INSERT INTO commerce_sales(id,branch_id) VALUES (1,1),(2,2);
      INSERT INTO commerce_refunds VALUES (1,1,10,'CASH'),(2,1,10,'CASH'),(3,1,10,'CASH'),(4,1,10,'CARD'),(5,1,10,'CASH'),(6,1,10,'CASH'),(7,1,10,'CASH'),(8,1,10,'CASH'),(9,1,10,'CASH'),(10,2,10,'CASH'),(11,1,10,'CASH'),(12,1,10,'CASH'),(13,1,10,'CASH'),(14,1,10,'CASH'),(15,1,10,'CASH'),(16,1,10,'CASH'),(17,1,10,'CASH');`);
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(read(f));
    await pg.exec(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by,opened_at) VALUES
      (1,'CUSTODY',3,100,'2020-01-01',1,'2020-01-01 00:00Z'),(1,'VAULT',NULL,0,'2020-01-01',1,'2020-01-01 00:00Z'),(2,'VAULT',NULL,0,'2020-01-01',1,'2020-01-01 00:00Z');
      UPDATE finance.accounts SET closed_at='2020-03-01 00:00Z',closed_by=1 WHERE id=1;
      INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,status,resolved_by,resolved_at,resolution_reason) VALUES
      (1,100,100,0,0,'2020-02-01','جرد اصطناعي',1,'CONFIRMED',1,'2020-02-01 00:00Z','تأكيد'),
      (2,0,0,0,0,'2020-02-01','جرد حساب آخر',1,'CONFIRMED',1,'2020-02-01 00:00Z','تأكيد');
      INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by) VALUES
      (2,0,0,0,0,'2020-02-01','جرد مفتوح',1);
      INSERT INTO finance.movements(kind,branch_id,source_id,amount,external_ref,actor_id,created_at,after_cash_count_id,after_opening) VALUES
      ('REFUND',1,1,10,'refund:2',1,'2020-02-02 00:00Z',NULL,false),
      ('REFUND',1,1,10,'refund:3',1,'2020-02-02 00:00Z',1,false),
      ('REFUND',1,1,10,'refund:4',1,'2020-02-02 00:00Z',NULL,true),
      ('REFUND',2,3,9,'refund:5',1,'2020-02-02 00:00Z',NULL,true),
      ('REFUND',1,1,10,'refund:6',1,'2020-02-02 00:00Z',2,false),
      ('REFUND',1,2,10,'refund:7',1,'2020-01-31 00:00Z',3,false),
      ('REFUND',1,1,10,'refund:8',1,'2020-02-01 00:00Z',1,false),
      ('REFUND',1,1,10,'refund:9',1,'2020-03-02 00:00Z',NULL,true),
      ('REFUND',1,1,10,'refund:11',1,'2019-12-31 00:00Z',NULL,true),
      ('REFUND',1,1,10,'refund:12',1,'2020-01-01 00:00Z',NULL,true),
      ('REFUND',1,1,10,'refund:13',1,'2020-03-01 00:00Z',NULL,true),
      ('REFUND',1,1,10,'refund:14',1,'2020-01-31 00:00Z',1,false),
      ('REFUND',1,1,10,'refund:16',1,'2020-02-02 00:00Z',1,false),
      ('REFUND',1,1,10,'refund:not-a-number',1,'2020-02-02 00:00Z',NULL,true),
      ('REFUND',1,1,10,'refund:999999999999999999999999999999999999999',1,'2020-02-02 00:00Z',NULL,true),
      ('REFUND',2,3,10,'refund:10',1,'2020-02-02 00:00Z',NULL,true);
      INSERT INTO finance.historical_commerce(event_type,event_id,sale_id,branch_id,account_id,amount,actual_date,checkpoint_type,checkpoint_count_id,checkpoint_date,verified_actual,before_checkpoint,included_in_checkpoint,not_previously_recorded,handler,reason,created_by) VALUES
      ('REFUND',3,1,1,1,10,'2020-01-01','COUNT',1,'2020-02-01',true,true,true,true,'شخص اصطناعي','تجربة',1),
      ('REFUND',1,1,1,1,9,'2020-01-01','COUNT',2,'2020-02-01',true,true,true,true,'شخص اصطناعي','تجربة',1),
      ('REFUND',17,1,1,1,10,'2020-01-01','COUNT',1,'2020-02-01',true,true,true,true,'شخص اصطناعي','تجربة',1),
      ('REFUND',999,1,1,1,10,'2020-01-01','OPENING',NULL,'2020-01-01',true,true,true,true,'شخص اصطناعي','تجربة',1);`);
    const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, args: unknown[] = []) => ({ rows: (await pg.query(sql, args)).rows as T[] }) };
    const snapshot = async () => (await pg.query(`SELECT (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM commerce_refunds r)::text AS refunds,(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM finance.movements m)::text AS movements,(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM finance.historical_commerce h)::text AS historical,(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM finance.cash_counts c)::text AS counts`)).rows[0];
    const before = await snapshot();
    await pg.exec("BEGIN READ ONLY");
    const result = await auditSyntheticRefunds(port,"1");
    const issues = (id: string) => result.refunds.find(r => r.refundId === id)?.findings;
    assert.deepEqual(issues("1"),["HISTORICAL_MISMATCH","HISTORICAL_COUNT_MISMATCH"]);
    assert.deepEqual(issues("2"),["CHECKPOINT_UNATTESTED"]);
    assert.deepEqual(issues("3"),["MOVEMENT_AND_HISTORICAL"]);
    assert.deepEqual(issues("4"),["NONCASH_WITH_CASH_EVIDENCE"]);
    assert.deepEqual(issues("5"),["MOVEMENT_MISMATCH"]);
    assert.deepEqual(issues("6"),["MOVEMENT_COUNT_MISMATCH"]);
    assert.deepEqual(issues("7"),["MOVEMENT_COUNT_MISMATCH"]);
    assert.deepEqual(issues("8"),["COUNT_MOVEMENT_TIMESTAMP_BOUNDARY"]);
    assert.deepEqual(issues("9"),["MOVEMENT_RECORDED_AFTER_CLOSE"]);
    assert.deepEqual(issues("11"),["MOVEMENT_RECORDED_BEFORE_OPENING"]);
    assert.deepEqual(issues("12"),["OPENING_TIMESTAMP_BOUNDARY"]);
    assert.deepEqual(issues("13"),["CLOSE_TIMESTAMP_BOUNDARY"]);
    assert.deepEqual(issues("14"),["COUNT_RECORDED_AFTER_MOVEMENT"]);
    assert.deepEqual(issues("15"),["NO_EVIDENCE"]);
    assert.deepEqual(issues("16"),[], "matching metadata is evidence, not proof of history");
    assert.deepEqual(issues("17"),[], "matching historical annotation is still only an attestation");
    assert.equal(result.orphanMovements.length,2); assert.equal(result.orphanHistorical.length,1);
    assert.deepEqual((await auditSyntheticRefunds(port,"2")).refunds.map(r=>r.refundId),["10"]);
    await assert.rejects(() => auditSyntheticRefunds(port,"1 OR true"), /invalid synthetic branch/);
    await pg.exec("ROLLBACK");
    assert.deepEqual(await snapshot(),before);
  } finally { await pg.close(); }
});
