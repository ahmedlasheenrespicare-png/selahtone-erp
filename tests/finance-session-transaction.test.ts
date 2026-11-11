import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { openAccount } from "../src/lib/finance/engine";
import { financeDbForActor, financeDbForSession } from "../src/lib/finance/session-transaction";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("financial writes and replays recheck the session role and branch in each transaction", {timeout:120_000}, async () => {
  const pg=new PGlite();
  try {
    for(const file of ["tests/fixtures/inventory-baseline.sql","tests/fixtures/finance-legacy-categories.sql","tests/fixtures/commerce-collections.sql","prisma/manual-access-control-upgrade.sql"]) await pg.exec(readFileSync(file,"utf8"));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'; CREATE TABLE public.auth_sessions (id varchar(64) PRIMARY KEY, user_id bigint NOT NULL REFERENCES public.users(id), expires_at timestamptz NOT NULL)");
    for(const file of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql"]) await pg.exec(readFileSync(file,"utf8"));
    const db:FinanceDatabase={serializable:work=>pg.transaction(async tx=>{
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port:FinanceTransaction={query:async <T extends Record<string,unknown>>(sql:string,params:unknown[]=[])=>({rows:(await tx.query(sql,params)).rows as T[]})};
      return work(port);
    })};
    const session={id:"1",role:"MANAGER",branchId:null,email:"manager@example.test"};
    const bound=financeDbForActor(db,session);
    const input={requestId:randomUUID(),branchId:"1",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:"2026-10-20",counted:true};
    const denied=(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden";
    const saved=await openAccount(bound,"1",input,"2026-11-07");
    assert.equal(saved.replayed,false);
    for(const [change,restore] of [
      ["UPDATE users SET branch_id=1 WHERE id=1","UPDATE users SET branch_id=NULL WHERE id=1"],
      ["UPDATE users SET role_code='ACCOUNTANT' WHERE id=1","UPDATE users SET role_code='MANAGER' WHERE id=1"],
      ["UPDATE users SET status='SUSPENDED' WHERE id=1","UPDATE users SET status='ACTIVE' WHERE id=1"],
      ["UPDATE users SET must_change_password=true WHERE id=1","UPDATE users SET must_change_password=false WHERE id=1"],
      ["UPDATE users SET email='changed@example.test' WHERE id=1","UPDATE users SET email='manager@example.test' WHERE id=1"],
    ] as const) {
      await pg.exec(change);
      await assert.rejects(()=>openAccount(bound,"1",input,"2026-11-07"),denied);
      await assert.rejects(()=>openAccount(bound,"1",{...input,requestId:randomUUID(),branchId:"2"},"2026-11-07"),denied);
      await pg.exec(restore);
      assert.deepEqual(await openAccount(bound,"1",input,"2026-11-07"),{id:saved.id,replayed:true});
    }
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0].n,1);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests")).rows[0].n,1);
    await assert.rejects(()=>openAccount(financeDbForActor(db,{...session,id:"9999"}),"9999",{...input,requestId:randomUUID()},"2026-11-07"),denied);
    const token="synthetic-finance-session",other="synthetic-other-session";
    await pg.query("INSERT INTO public.auth_sessions(id,user_id,expires_at) VALUES($1,1,clock_timestamp()+interval '1 hour'),($2,2,clock_timestamp()+interval '1 hour')",[token,other]);
    const authenticatedSession={...session,sessionId:token};
    const authorized=financeDbForSession(db,authenticatedSession,"/finance/accounts#open");
    assert.deepEqual(await openAccount(authorized,"1",input,"2026-11-07"),{id:saved.id,replayed:true});
    await assert.rejects(()=>openAccount(financeDbForSession(db,{...session,sessionId:other},"/finance/accounts#open"),"1",input,"2026-11-07"),denied);

    // Regression: the HTTP guard may have allowed the request before an admin
    // revoked the rule. The transaction must read the current rule for itself,
    // rather than treating the outer decision as authorization to commit.
    const revokedInput={...input,requestId:randomUUID(),branchId:"2"};
    const revokedBeforeTransaction:FinanceDatabase={serializable:async work=>{
      await pg.query(`INSERT INTO public.access_control(subject_kind,subject,key,allowed)
        VALUES('role','MANAGER','/finance/accounts#open',true)
        ON CONFLICT(subject_kind,subject,key) DO UPDATE SET allowed=true`);
      await pg.exec("UPDATE public.access_control SET allowed=false WHERE subject_kind='role' AND subject='MANAGER' AND key='/finance/accounts#open'");
      return db.serializable(work);
    }};
    await assert.rejects(()=>openAccount(
      financeDbForSession(revokedBeforeTransaction,authenticatedSession,"/finance/accounts#open"),
      "1",revokedInput,"2026-11-07"),/تغيّرت صلاحية هذه العملية/);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=2")).rows[0].n,0);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[revokedInput.requestId])).rows[0].n,0);
    // A per-user allow still overrides the role deny, matching the outer guard.
    await pg.query(`INSERT INTO public.access_control(subject_kind,subject,key,allowed)
      VALUES('user','1','/finance/accounts#open',true)`);
    assert.equal((await openAccount(authorized,"1",revokedInput,"2026-11-07")).replayed,false);
    await pg.query("UPDATE public.auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[token]);
    await assert.rejects(()=>openAccount(authorized,"1",input,"2026-11-07"),denied);
    await assert.rejects(()=>openAccount(authorized,"1",{...input,requestId:randomUUID(),branchId:"2"},"2026-11-07"),denied);
    await pg.query("DELETE FROM public.auth_sessions WHERE id=$1",[token]);
    await assert.rejects(()=>openAccount(authorized,"1",input,"2026-11-07"),denied);
    await pg.query("INSERT INTO public.auth_sessions(id,user_id,expires_at) VALUES($1,1,clock_timestamp()+interval '1 hour')",[token]);
    assert.deepEqual(await openAccount(authorized,"1",input,"2026-11-07"),{id:saved.id,replayed:true});
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0].n,2);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests")).rows[0].n,2);
  } finally {await pg.close();}
});
