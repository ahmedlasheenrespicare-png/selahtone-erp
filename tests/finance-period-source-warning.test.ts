/** Read-only hints on disposable records; no actual cash is inferred. */
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { periodSourceWarning } from "../src/lib/finance/period-source-warning";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("recorder mismatch hint is scoped and does not infer missing history", {timeout:120_000}, async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`CREATE SCHEMA finance;
      CREATE TABLE public.commerce_sales(id bigint primary key,branch_id bigint,created_by_id bigint);
      CREATE TABLE public.commerce_collections(id bigint primary key,sale_id bigint,method text,created_by_id bigint,created_at timestamptz);
      CREATE TABLE finance.expenses(id bigint primary key,branch_id bigint,requested_by bigint);
      CREATE TABLE finance.payments(id bigint primary key,expense_id bigint,source text,recorded_by bigint,recorded_at timestamptz);
      INSERT INTO public.commerce_sales VALUES (1,1,3),(2,1,8),(3,2,3);
      INSERT INTO public.commerce_collections VALUES
        (1,1,'CASH',3,'2026-01-02T00:00:01Z'),
        (2,1,'CARD',8,'2026-01-02T00:00:01Z'),
        (3,2,'CASH',9,'2026-01-02T00:00:01Z'),
        (4,3,'CASH',8,'2026-01-02T00:00:01Z'),
        (5,1,'CASH',8,'2026-01-01T23:59:59Z');
      INSERT INTO finance.expenses VALUES (1,1,3),(2,1,8),(3,2,3);
      INSERT INTO finance.payments VALUES
        (1,1,'HOLDER_CASH',3,'2026-01-02T00:00:01Z'),
        (2,1,'ACCOUNT',8,'2026-01-02T00:00:01Z'),
        (3,2,'HOLDER_CASH',9,'2026-01-02T00:00:01Z'),
        (4,3,'HOLDER_CASH',8,'2026-01-02T00:00:01Z'),
        (5,1,'HOLDER_CASH',8,'2026-01-01T23:59:59Z')`);
    const tx:FinanceTransaction={query:async <T extends Record<string,unknown>>(sql:string,params:unknown[]=[])=>({rows:(await pg.query(sql,params)).rows as T[]})};
    const hint=(branch="1",holder:string|null="3")=>periodSourceWarning(tx,branch,holder,"2026-01-02T00:00:00Z");
    assert.equal(await hint(),false,"other holders, branches, noncash, account payments and older rows do not raise this holder hint");
    assert.equal(await hint("1",null),false);
    await pg.exec("INSERT INTO public.commerce_collections VALUES (6,1,'CASH',8,'2026-01-02T00:00:00Z')");
    assert.equal(await hint(),true,"equal boundary remains a warning");
    assert.equal(await hint("1","8"),true,"recorder sees the other side too");
    await pg.exec("DELETE FROM public.commerce_collections WHERE id=6; INSERT INTO public.commerce_collections VALUES (7,1,'CASH',NULL,'2026-01-02T00:00:01Z')");
    assert.equal(await hint(),true,"a missing recorded collector is uncertain");
    await pg.exec("DELETE FROM public.commerce_collections WHERE id=7; INSERT INTO finance.payments VALUES (6,1,'HOLDER_CASH',8,'2026-01-02T00:00:01Z')");
    assert.equal(await hint(),true,"the payer/expense-requester mismatch is reported");
    assert.equal(await hint("1","8"),true);
    await pg.exec("DELETE FROM finance.payments WHERE id=6");
    assert.equal(await hint(),false,"absence of this narrow warning does not prove attribution");
    await assert.rejects(()=>periodSourceWarning({query:async()=>({rows:[]})},"1","3","2026-01-02T00:00:00Z"),/warning unavailable/);
  } finally {await pg.close();}
});
