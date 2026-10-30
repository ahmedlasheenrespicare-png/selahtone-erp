/**
 * Verifies the MANUAL settlement migration (prisma/manual-settlement-upgrade.sql)
 * against the reviewed candidate schema on a disposable database: the new table,
 * the new movement kind, the payments source column, and that the rebuilt
 * constraints accept a valid settlement movement and still reject a malformed one.
 * Never touches DATABASE_URL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");
const candidate = read("prototypes/finance-release/release-candidate.test-only.sql");
const upgrade = read("prisma/manual-settlement-upgrade.sql");

test("settlement upgrade installs the table, the movement kind and the payment source", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql"]) await pg.exec(read(f));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    await pg.exec(candidate);
    await pg.exec(upgrade);

    const report = (await pg.query<{ r: string }>("SELECT (\n" +
      "  SELECT jsonb_build_object(\n" +
      "    'settlements_table', (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='finance' AND table_name='settlements'),\n" +
      "    'settlement_index', (SELECT count(*)::int FROM pg_class WHERE relname='finance_one_open_settlement_per_account'),\n" +
      "    'movement_column', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='finance' AND table_name='movements' AND column_name='settlement_id'),\n" +
      "    'payment_column', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='finance' AND table_name='payments' AND column_name='source'),\n" +
      "    'kind_allows_settlement', (SELECT count(*)::int FROM pg_constraint WHERE conname='movements_kind_check' AND pg_get_constraintdef(oid) ILIKE '%SETTLEMENT%')\n" +
      "  )::text) AS r")).rows[0].r;
    assert.deepEqual(JSON.parse(report), {
      settlements_table: 1,
      settlement_index: 1,
      movement_column: 1,
      payment_column: 1,
      kind_allows_settlement: 1,
    });

    // طلب تسوية مفتوح واحد فقط لكل عهدة.
    await pg.exec(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
      VALUES (1,'CUSTODY',3,1000,'2026-10-20',1)`);
    await pg.exec(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES (1,1,3,1000,5200,5000,800,5200,0,4200,'تسوية فترة')`);
    await assert.rejects(() => pg.exec(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES (1,1,3,1000,5300,5000,800,5200,100,4300,'طلب ثانٍ')`));

    // حركة تسوية صحيحة مقبولة، وحركة بلا مرجع مرفوضة.
    await pg.exec(`INSERT INTO finance.movements(kind,branch_id,destination_id,amount,settlement_id,actor_id)
      VALUES ('SETTLEMENT',1,1,4200,1,1)`);
    await assert.rejects(() => pg.exec(`INSERT INTO finance.movements(kind,branch_id,destination_id,amount,actor_id)
      VALUES ('SETTLEMENT',1,1,100,1)`));

    // مصروف من نقد الموظف: نقدي بلا حساب ومصدره HOLDER_CASH مقبول؛ ونقدي بلا حساب ومصدره ACCOUNT مرفوض.
    await pg.exec(`INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
      VALUES (1,1,'بند',800,'2026-10-21','مصروف','APPROVED',3,1,CURRENT_TIMESTAMP)`);
    await pg.exec(`INSERT INTO finance.payments(expense_id,amount,method,payment_date,recorded_by,actually_paid,source)
      VALUES (1,800,'CASH','2026-10-21',3,true,'HOLDER_CASH')`);
    await assert.rejects(() => pg.exec(`INSERT INTO finance.payments(expense_id,amount,method,payment_date,recorded_by,actually_paid,source)
      VALUES (1,801,'CASH','2026-10-21',1,true,'ACCOUNT')`));
  } finally {
    await pg.close();
  }
});
