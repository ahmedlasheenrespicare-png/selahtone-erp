import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { TRANSFER_MONTH_SQL, TRANSFER_SCOPE_SQL } from "../src/lib/finance/transfers-overview-sql";

test("transfer month aggregation: Cairo boundaries, direction, full volume and staff scope", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.accounts (id bigint PRIMARY KEY, kind text NOT NULL);
      CREATE TABLE finance.movements (id bigint PRIMARY KEY,kind text NOT NULL,branch_id bigint NOT NULL,source_id bigint,destination_id bigint,amount numeric(14,2),created_at timestamptz NOT NULL);
      INSERT INTO finance.accounts VALUES (1,'VAULT'),(2,'CUSTODY'),(3,'CUSTODY'),(4,'VAULT'),(5,'CUSTODY');
      INSERT INTO finance.movements SELECT n,'TRANSFER',1,2,1,1.00,'2026-03-15T09:00:00Z' FROM generate_series(1,101) n;
      INSERT INTO finance.movements VALUES
        (102,'TRANSFER',1,2,1,10,'2026-02-28T22:00:00Z'),
        (103,'TRANSFER',1,2,1,9,'2026-02-28T21:59:59Z'),
        (104,'TRANSFER',1,1,2,13,'2026-03-16T09:00:00Z'),
        (105,'TRANSFER',1,3,1,88,'2026-03-16T09:00:00Z'),
        (106,'TRANSFER',2,5,4,12,'2026-03-16T09:00:00Z'),
        (107,'TRANSFER',1,2,1,20,'2026-03-31T22:00:00Z'),
        (108,'EXPENSE',1,2,NULL,100,'2026-03-16T09:00:00Z'),
        (109,'TRANSFER',1,2,1,100,'2099-01-10T00:00:00Z');`);
    const rows = (await db.query<{ branchId: string; dateKey: string; direction: string; amount: string; count: number }>(TRANSFER_MONTH_SQL, [false, '1', '2', '2026-03-01'])).rows;
    assert.deepEqual(rows, [
      { branchId: '1', dateKey: '2026-03-01', direction: 'TO_VAULT', amount: '10.00', count: 1 },
      { branchId: '1', dateKey: '2026-03-15', direction: 'TO_VAULT', amount: '101.00', count: 101 },
      { branchId: '1', dateKey: '2026-03-16', direction: 'TO_CUSTODY', amount: '13.00', count: 1 },
    ]);
    const manager = (await db.query<{amount:string;count:number}>(TRANSFER_MONTH_SQL, [true,null,null,'2026-03-01'])).rows;
    assert.equal(manager.reduce((total, row) => total + row.count, 0), 105);
    assert.equal(manager.reduce((total, row) => total + Number(row.amount), 0), 224);
    assert.equal((await db.query(TRANSFER_MONTH_SQL, [false,null,'2','2026-03-01'])).rows.length, 0);
    assert.equal((await db.query(TRANSFER_MONTH_SQL, [false,'1',null,'2026-03-01'])).rows.length, 0);
    assert.equal((await db.query(TRANSFER_MONTH_SQL, [true,null,null,'2099-01-01'])).rows.length, 0, 'future records must not be counted');
    const ledger = await db.query<{id: string}>(`SELECT m.id FROM finance.movements m WHERE ${TRANSFER_SCOPE_SQL} ORDER BY m.id DESC LIMIT 100`, [false,'1','2']);
    assert.equal(ledger.rows.length, 100);
    assert.ok(!ledger.rows.some(row => String(row.id) === '1'));
  } finally { await db.close(); }
});
