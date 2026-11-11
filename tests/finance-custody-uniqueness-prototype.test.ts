/** Disposable PGlite only. No production database, no automatic repair. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (f: string) => readFileSync(f, "utf8");
test("synthetic global open-custody index refuses conflicts without repair", { timeout: 60000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql"]) await pg.exec(read(f));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    await pg.exec(read("prototypes/finance-release/release-candidate.test-only.sql"));
    await pg.exec(read("prisma/manual-custody-closure-upgrade.sql"));
    const script = read("prototypes/finance-custody-uniqueness/index.test-only.sql");
    await assert.rejects(() => pg.exec(script), /requires explicit opt-in/); await pg.exec("ROLLBACK");
    await pg.exec("SET selahtone.custody_uniqueness_test_only='yes'");
    await pg.exec(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
      VALUES(1,'CUSTODY',3,0,CURRENT_DATE,1),(2,'CUSTODY',3,0,CURRENT_DATE,1)`);
    const before = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0].n;
    await assert.rejects(() => pg.exec(script), /multiple open custodies/); await pg.exec("ROLLBACK");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0].n, before);
    assert.equal((await pg.query<{ ok: boolean }>("SELECT to_regclass('finance.finance_one_open_custody_per_holder_test_only') IS NOT NULL AS ok")).rows[0].ok, false);
    // Set aside a synthetic duplicate, not an approved method of remediation.
    await pg.exec("UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE branch_id=2 AND holder_id=3");
    await pg.exec(script);
    await pg.exec("INSERT INTO branches(code,name_ar,invoice_prefix) VALUES ('B3','فرع اصطناعي ثالث','B3')");
    await assert.rejects(() => pg.exec(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES(3,'CUSTODY',3,0,CURRENT_DATE,1)`), /finance_one_open_custody_per_holder_test_only/);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts WHERE holder_id=3 AND closed_at IS NULL")).rows[0].n, 1);
    await assert.rejects(() => pg.exec(script), /already exists/); await pg.exec("ROLLBACK");
    // The old permanent branch/holder index was not dropped or relaxed.
    assert.equal((await pg.query<{ ok: boolean }>("SELECT to_regclass('finance.finance_custody_per_holder') IS NOT NULL AS ok")).rows[0].ok, true);
  } finally { await pg.close(); }
});

test("synthetic preflight refuses a null holder even when a permissive schema allows it", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.accounts(id bigint PRIMARY KEY,kind text,holder_id bigint,closed_at timestamptz);
      INSERT INTO finance.accounts VALUES (1,'CUSTODY',NULL,NULL);
      SET selahtone.custody_uniqueness_test_only='yes'`);
    await assert.rejects(() => pg.exec(read("prototypes/finance-custody-uniqueness/index.test-only.sql")), /open custody without a holder/);
    await pg.exec("ROLLBACK");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts WHERE holder_id IS NULL AND closed_at IS NULL")).rows[0].n, 1);
    assert.equal((await pg.query<{ ok: boolean }>("SELECT to_regclass('finance.finance_one_open_custody_per_holder_test_only') IS NOT NULL AS ok")).rows[0].ok, false);
  } finally { await pg.close(); }
});

test("synthetic unique index alone cannot prevent a later null holder in a permissive schema", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.accounts(id bigint PRIMARY KEY,kind text,holder_id bigint,closed_at timestamptz);
      SET selahtone.custody_uniqueness_test_only='yes'`);
    await pg.exec(read("prototypes/finance-custody-uniqueness/index.test-only.sql"));
    await pg.exec("INSERT INTO finance.accounts VALUES (1,'CUSTODY',NULL,NULL),(2,'CUSTODY',NULL,NULL)");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts WHERE holder_id IS NULL AND closed_at IS NULL")).rows[0].n, 2);
  } finally { await pg.close(); }
});
