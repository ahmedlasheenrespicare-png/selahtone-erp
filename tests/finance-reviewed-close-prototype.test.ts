/** Disposable PGlite / WASM only, no production DB and no history mutation. */
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
import { cancelCashCount, cancelSettlement, closeAccount, openAccount, requestCountFromHolder, requestSettlement, submitHolderCount, transferCash } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import { FinanceProblem, type FinanceDatabase } from "../src/lib/finance/types";
import { syntheticCloseAccountSnapshot, syntheticCloseAccountSnapshotV2, syntheticCloseRequestIdentity } from "../prototypes/finance-custody-reopen/close-identity.test-only";
import { reviewedCloseTestOnly } from "../prototypes/finance-custody-reopen/reviewed-close.test-only";
import { readSyntheticClosePendingSnapshot, syntheticClosePendingSnapshot } from "../prototypes/finance-custody-reopen/pending-snapshot.test-only";
import { inspectSyntheticCloseEvidence } from "../prototypes/finance-custody-reopen/close-evidence-audit.test-only";

const root=process.cwd(), require=createRequire(join(root,"package.json"));
const {PrismaClient:WasmClient}=require("@prisma/client/wasm") as {PrismaClient:new(options:{adapter:unknown})=>PrismaClient};
test("reviewed synthetic closure compares locked identity and preserves legacy replay",{timeout:120_000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"selahtone-reviewed-close-")); let pg:PGlite|undefined,client:PrismaClient|undefined;
  try {
    execFileSync(process.execPath,[join(root,"scripts/local-pglite-preview.cjs")],{cwd:root,env:{...process.env,PREVIEW_PGLITE_DIR:dir,PREVIEW_PASSWORD:"Synthetic-Test-2026!"},stdio:"pipe",timeout:60_000});
    pg=new PGlite(dir); await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for(const f of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql"]) await pg.exec(readFileSync(join(root,f),"utf8"));
    await pg.exec(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'حامل اصطناعي '||n,'review-close-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(4,11) n WHERE id=3`);
    client=new WasmClient({adapter:new PrismaPGlite(pg)});
    const db:FinanceDatabase={serializable:work=>client!.$transaction(tx=>work(financePort(tx)),{isolationLevel:"Serializable",timeout:20000})};
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo"}).format(new Date());
    const open=(holderId:string)=>openAccount(db,"1",{requestId:randomUUID(),branchId:"1",kind:"CUSTODY",holderId,openingAmount:"0",openingDate:today,counted:true},today);
    const old=await open("3"), current=await open("4");
    const oldInput={requestId:randomUUID(),accountId:old.id,reason:"إقفال قديم اصطناعي"};
    await closeAccount(db,"1",oldInput);
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",oldInput),{id:old.id,replayed:true});
    const oldSnapshot=syntheticCloseAccountSnapshot({id:old.id,branchId:"1",kind:"CUSTODY",holderId:"3",closed:false});
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",{...oldInput,expectedAccountSnapshot:oldSnapshot}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="request_conflict");
    const base={requestId:randomUUID(),accountId:current.id,reason:"إقفال جديد اصطناعي"};
    const expected=syntheticCloseAccountSnapshot({id:current.id,branchId:"1",kind:"CUSTODY",holderId:"4",closed:false});
    const reviewed={...base,expectedAccountSnapshot:expected};
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",base),(e:unknown)=>e instanceof FinanceProblem&&e.code==="review_required");
    await pg.query("UPDATE finance.accounts SET holder_id=5 WHERE id=$1::bigint",[current.id]);
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",reviewed),(e:unknown)=>e instanceof FinanceProblem&&e.code==="account_changed");
    assert.equal((await pg.query<{closed:boolean}>("SELECT closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[current.id])).rows[0].closed,false);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[base.requestId])).rows[0].n,0);
    await pg.query("UPDATE finance.accounts SET holder_id=4 WHERE id=$1::bigint",[current.id]);
    const saved=await reviewedCloseTestOnly(db,"1",reviewed);
    assert.equal(saved.replayed,false);
    const stored=(await pg.query<{hash:string}>("SELECT request_hash AS hash FROM finance.requests WHERE request_id=$1::uuid",[base.requestId])).rows[0].hash.trim();
    assert.equal(stored,syntheticCloseRequestIdentity("1",base,reviewed).reviewedHash);
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",reviewed),{id:current.id,replayed:true});
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",base),(e:unknown)=>e instanceof FinanceProblem&&e.code==="request_conflict");
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",{...reviewed,reason:"تغيير السبب"}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="request_conflict");
    await assert.rejects(()=>reviewedCloseTestOnly(db,"3",reviewed),(e:unknown)=>e instanceof FinanceProblem&&e.code==="forbidden");
    // The SQL-only comparator associates candidate evidence by account and
    // actor, not by a real event/request foreign key. It cannot prove history.
    const inspect=(id:string)=>db.serializable(tx=>inspectSyntheticCloseEvidence(tx,id));
    assert.equal(await inspect(old.id),"legacy_candidate");
    assert.equal(await inspect(current.id),"reviewed_current_match");
    await pg.query("UPDATE finance.accounts SET holder_id=5 WHERE id=$1::bigint",[current.id]);
    assert.equal(await inspect(current.id),"unresolved","current identity no longer matches the synthetic reviewed digest");
    await pg.query("UPDATE finance.accounts SET holder_id=4 WHERE id=$1::bigint",[current.id]);
    assert.equal(await inspect(current.id),"reviewed_current_match","a changed-then-restored holder is invisible to the digest");
    await pg.query("UPDATE finance.audit_events SET reason='معدل اصطناعي' WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint",[current.id]);
    assert.equal(await inspect(current.id),"unresolved","a reason mismatch is not evidence that the holder changed");
    await pg.query("UPDATE finance.audit_events SET reason=$2 WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint",[current.id,base.reason]);
    // An actor with direct SQL write access can replace both the current
    // identity and its unkeyed digest; a match cannot authenticate history.
    await pg.query("UPDATE finance.accounts SET holder_id=5 WHERE id=$1::bigint",[current.id]);
    const rewrittenSnapshot=syntheticCloseAccountSnapshot({id:current.id,branchId:"1",kind:"CUSTODY",holderId:"5",closed:false});
    const rewrittenHash=syntheticCloseRequestIdentity("1",base,{expectedAccountSnapshot:rewrittenSnapshot}).reviewedHash;
    await pg.query("UPDATE finance.requests SET request_hash=$2 WHERE request_id=$1::uuid",[base.requestId,rewrittenHash]);
    assert.equal(await inspect(current.id),"reviewed_current_match","a rewritten unkeyed digest can conceal the synthetic identity change");
    await pg.query("UPDATE finance.accounts SET holder_id=4 WHERE id=$1::bigint",[current.id]);
    await pg.query("UPDATE finance.requests SET request_hash=$2 WHERE request_id=$1::uuid",[base.requestId,stored]);
    await pg.query(`INSERT INTO finance.audit_events(entity_type,entity_id,action,actor_id,reason) VALUES('ACCOUNT',$1::bigint,'CLOSE',1,$2)`,[current.id,base.reason]);
    assert.equal(await inspect(current.id),"ambiguous_sources","no invented link between multiple candidate audit rows and a request");
    // Equal opposing recorded movements advance the account revision, but the
    // current identity-only fingerprint deliberately does not contain it.
    // The service still performs its ordinary balance and pending checks.
    const vault=await openAccount(db,"1",{requestId:randomUUID(),branchId:"1",kind:"VAULT",holderId:null,openingAmount:"10",openingDate:today,counted:true},today);
    const cycled=await open("6");
    const cycleSnapshot=syntheticCloseAccountSnapshot({id:cycled.id,branchId:"1",kind:"CUSTODY",holderId:"6",closed:false});
    const beforeRevision=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[cycled.id])).rows[0].revision;
    await transferCash(db,"1",{requestId:randomUUID(),fromId:vault.id,toId:cycled.id,amount:"5",expectedBalance:"10",actuallyTransferred:true});
    await transferCash(db,"1",{requestId:randomUUID(),fromId:cycled.id,toId:vault.id,amount:"5",expectedBalance:"5",actuallyTransferred:true});
    const cycleState=(await pg.query<{revision:string;balance:string;n:number}>(`SELECT a.revision::text AS revision,
      (a.opening_amount+COALESCE((SELECT SUM(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS balance,
      (SELECT count(*)::int FROM finance.movements WHERE source_id=a.id OR destination_id=a.id) AS n FROM finance.accounts a WHERE a.id=$1::bigint`,[cycled.id])).rows[0];
    assert.notEqual(cycleState.revision,beforeRevision); assert.equal(cycleState.balance,"0.00"); assert.equal(cycleState.n,2);
    const cycledClose={requestId:randomUUID(),accountId:cycled.id,reason:"إقفال بعد حركتين اصطناعيتين",expectedAccountSnapshot:cycleSnapshot};
    assert.equal((await reviewedCloseTestOnly(db,"1",cycledClose)).replayed,false,"identity-only snapshot cannot detect the intervening revision");
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",cycledClose),{id:cycled.id,replayed:true});
    const versionedAccount=await open("7");
    const revisionBefore=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[versionedAccount.id])).rows[0].revision;
    const reviewedV2=syntheticCloseAccountSnapshotV2({id:versionedAccount.id,branchId:"1",kind:"CUSTODY",holderId:"7",closed:false,revision:revisionBefore});
    const staleV2={requestId:randomUUID(),accountId:versionedAccount.id,reason:"مراجعة نسخة اصطناعية",reviewVersion:2,expectedAccountSnapshot:reviewedV2};
    await transferCash(db,"1",{requestId:randomUUID(),fromId:vault.id,toId:versionedAccount.id,amount:"5",expectedBalance:"10",actuallyTransferred:true});
    await transferCash(db,"1",{requestId:randomUUID(),fromId:versionedAccount.id,toId:vault.id,amount:"5",expectedBalance:"5",actuallyTransferred:true});
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",staleV2),(e:unknown)=>e instanceof FinanceProblem&&e.code==="account_changed");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[staleV2.requestId])).rows[0].n,0);
    assert.equal((await pg.query<{closed:boolean}>("SELECT closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[versionedAccount.id])).rows[0].closed,false);
    const revisionAfter=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[versionedAccount.id])).rows[0].revision;
    assert.notEqual(revisionAfter,revisionBefore);
    const freshV2={...staleV2,requestId:randomUUID(),expectedAccountSnapshot:syntheticCloseAccountSnapshotV2({id:versionedAccount.id,branchId:"1",kind:"CUSTODY",holderId:"7",closed:false,revision:revisionAfter})};
    assert.equal((await reviewedCloseTestOnly(db,"1",freshV2)).replayed,false);
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",freshV2),{id:versionedAccount.id,replayed:true});
    assert.equal(await inspect(versionedAccount.id),"reviewed_v2_current_match","v2 comparison only uses current state and a guessed pre-closure open state");
    // Evidence classification and replay are independent: missing, conflicting,
    // or multiple candidate rows must not be treated as a unique match.
    const duplicateRequestId=randomUUID();
    await pg.query(`INSERT INTO finance.requests(request_id,request_hash,actor_id,action,result_id)
      SELECT $2::uuid,request_hash,actor_id,action,result_id FROM finance.requests WHERE request_id=$1::uuid`,[freshV2.requestId,duplicateRequestId]);
    await pg.query(`INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id)
      SELECT $2::uuid,action,actor_id,result_table,result_id FROM finance.request_results WHERE request_id=$1::uuid`,[freshV2.requestId,duplicateRequestId]);
    assert.equal(await inspect(versionedAccount.id),"ambiguous_sources","multiple request candidates cannot be linked to one audit event");
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",freshV2),{id:versionedAccount.id,replayed:true});
    await pg.query("DELETE FROM finance.requests WHERE request_id=$1::uuid",[duplicateRequestId]);
    await pg.query("DELETE FROM finance.request_results WHERE request_id=$1::uuid",[duplicateRequestId]);
    await pg.query("UPDATE finance.audit_events SET actor_id=3 WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint",[versionedAccount.id]);
    assert.equal(await inspect(versionedAccount.id),"state_inconsistent","a different audit actor is not a match");
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",freshV2),{id:versionedAccount.id,replayed:true});
    await pg.query("UPDATE finance.audit_events SET actor_id=1 WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint",[versionedAccount.id]);
    // Even a single, uniquely matching event can be an unrelated row: the
    // schema contains no request ID linking it to this close request. Hide the
    // original event in this disposable fixture and substitute an older one.
    const originalAudit=(await pg.query<{id:string}>(`UPDATE finance.audit_events SET action='SYNTHETIC_HIDDEN'
      WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint RETURNING id::text AS id`,[versionedAccount.id])).rows;
    assert.equal(originalAudit.length,1);
    assert.equal(await inspect(versionedAccount.id),"ambiguous_sources","missing audit evidence is not a match");
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",freshV2),{id:versionedAccount.id,replayed:true});
    const unrelated=(await pg.query<{id:string}>(`INSERT INTO finance.audit_events(entity_type,entity_id,action,actor_id,reason,created_at)
      VALUES('ACCOUNT',$1::bigint,'CLOSE',1,$2,'2000-01-01T00:00:00Z') RETURNING id::text AS id`,[versionedAccount.id,freshV2.reason])).rows[0];
    assert.equal(await inspect(versionedAccount.id),"reviewed_v2_current_match","a unique but unrelated candidate can still match");
    await pg.query("DELETE FROM finance.audit_events WHERE id=$1::bigint",[unrelated.id]);
    await pg.query("UPDATE finance.audit_events SET action='CLOSE' WHERE id=$1::bigint",[originalAudit[0].id]);
    await pg.query("UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint",[versionedAccount.id]);
    assert.equal(await inspect(versionedAccount.id),"unresolved","a later revision is not evidence of what specifically changed");
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",freshV2),{id:versionedAccount.id,replayed:true},"replay does not recheck a later revision");
    // A privileged uncoordinated writer can rewrite both the current account
    // revision/identity and unkeyed request digest after the saved closure.
    await pg.query("UPDATE finance.accounts SET holder_id=8 WHERE id=$1::bigint",[versionedAccount.id]);
    const fabricatedRevision=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[versionedAccount.id])).rows[0].revision;
    const fabricatedSnapshot=syntheticCloseAccountSnapshotV2({id:versionedAccount.id,branchId:"1",kind:"CUSTODY",holderId:"8",closed:false,revision:fabricatedRevision});
    const fabricatedHash=syntheticCloseRequestIdentity("1",{requestId:freshV2.requestId,accountId:freshV2.accountId,reason:freshV2.reason},{reviewVersion:2,expectedAccountSnapshot:fabricatedSnapshot}).reviewedHash;
    await pg.query("UPDATE finance.requests SET request_hash=$2 WHERE request_id=$1::uuid",[freshV2.requestId,fabricatedHash]);
    assert.equal(await inspect(versionedAccount.id),"reviewed_v2_current_match","rewriting the unkeyed digest conceals the synthetic change");
    await pg.query("UPDATE finance.accounts SET holder_id=7 WHERE id=$1::bigint",[versionedAccount.id]);
    const originalV2Hash=syntheticCloseRequestIdentity("1",{requestId:freshV2.requestId,accountId:freshV2.accountId,reason:freshV2.reason},freshV2).reviewedHash;
    await pg.query("UPDATE finance.requests SET request_hash=$2 WHERE request_id=$1::uuid",[freshV2.requestId,originalV2Hash]);
    const {reviewVersion:_dropped,...removedVersion}=freshV2;
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",removedVersion),(e:unknown)=>e instanceof FinanceProblem&&e.code==="request_conflict");
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",{...cycledClose,reviewVersion:2}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="request_conflict");
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",{...oldInput,reviewVersion:2}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="request_conflict");
    // Even cooperating service writes do not make revision a complete change
    // history: cancellation updates the count, not the account revision.
    const cancelledCountAccount=await open("9");
    const directed=await requestCountFromHolder(db,"1",{requestId:randomUUID(),accountId:cancelledCountAccount.id,reason:"طلب جرد اصطناعي"});
    const countRevision=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[cancelledCountAccount.id])).rows[0].revision;
    const countClose={requestId:randomUUID(),accountId:cancelledCountAccount.id,reason:"إقفال بعد إلغاء جرد اصطناعي",reviewVersion:2,expectedAccountSnapshot:syntheticCloseAccountSnapshotV2({id:cancelledCountAccount.id,branchId:"1",kind:"CUSTODY",holderId:"9",closed:false,revision:countRevision})};
    // Independent pure comparison only; the close adapter does not consume it.
    const pendingBefore=syntheticClosePendingSnapshot(countClose.expectedAccountSnapshot,[directed.id],[]);
    const readPending=(id:string)=>db.serializable(tx=>readSyntheticClosePendingSnapshot(tx,id));
    assert.equal(await readPending(cancelledCountAccount.id),pendingBefore);
    assert.equal(await readPending("999999999"),null,"a missing account does not become an empty snapshot");
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",countClose),(e:unknown)=>e instanceof FinanceProblem&&e.code==="account_pending");
    // Submitting a directed count changes its contents but leaves both its
    // open ID and the account revision unchanged. The helper cannot detect it.
    const submission={requestId:randomUUID(),countId:directed.id,countedAmount:"3",actuallyCounted:true};
    assert.equal((await submitHolderCount(db,"9",submission)).replayed,false);
    const submitted=(await pg.query<{counterId:string;status:string;revision:string;countedAmount:string}>(`SELECT c.counter_id::text AS "counterId",c.status,a.revision::text AS revision,c.counted_amount::text AS "countedAmount"
      FROM finance.cash_counts c JOIN finance.accounts a ON a.id=c.account_id WHERE c.id=$1::bigint`,[directed.id])).rows[0];
    assert.equal(submitted.counterId,"9"); assert.equal(submitted.countedAmount,"3.00"); assert.equal(submitted.status,"OPEN"); assert.equal(submitted.revision,countRevision);
    assert.equal(syntheticClosePendingSnapshot(countClose.expectedAccountSnapshot,[directed.id],[]),pendingBefore,"an unchanged set does not fingerprint count contents");
    assert.equal(await readPending(cancelledCountAccount.id),pendingBefore);
    assert.deepEqual(await submitHolderCount(db,"9",submission),{id:directed.id,replayed:true});
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",countClose),(e:unknown)=>e instanceof FinanceProblem&&e.code==="account_pending");
    const cancellation={requestId:randomUUID(),countId:directed.id,reason:"إلغاء جرد اصطناعي"};
    assert.equal((await cancelCashCount(db,"1",cancellation)).replayed,false);
    assert.equal((await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[cancelledCountAccount.id])).rows[0].revision,countRevision);
    assert.equal((await pg.query<{status:string}>("SELECT status FROM finance.cash_counts WHERE id=$1::bigint",[directed.id])).rows[0].status,"CANCELLED");
    const stillOpen=(await pg.query<{id:string}>("SELECT id::text AS id FROM finance.cash_counts WHERE account_id=$1::bigint AND status='OPEN'",[cancelledCountAccount.id])).rows.map(row=>row.id);
    assert.notEqual(syntheticClosePendingSnapshot(countClose.expectedAccountSnapshot,stillOpen,[]),pendingBefore,"a current open-ID comparison detects this cancellation");
    assert.equal(await readPending(cancelledCountAccount.id),syntheticClosePendingSnapshot(countClose.expectedAccountSnapshot,stillOpen,[]));
    assert.notEqual(await readPending(cancelledCountAccount.id),pendingBefore);
    assert.equal((await reviewedCloseTestOnly(db,"1",countClose)).replayed,false,"v2 account revision does not cover count cancellation");
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",countClose),{id:cancelledCountAccount.id,replayed:true});
    assert.deepEqual(await cancelCashCount(db,"1",cancellation),{id:directed.id,replayed:true});
    // Read a real open settlement and verify that another account's count is
    // not accidentally included. This reader is not an authorization boundary.
    const settleAccount=await open("10"), otherAccount=await open("11");
    const settlementInput={requestId:randomUUID(),accountId:settleAccount.id,countedAmount:"0",expectedBalance:"0",reason:"تسوية قراءة اصطناعية",actuallyCounted:true};
    const settlement=await requestSettlement(db,"10",settlementInput);
    const settleRevision=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[settleAccount.id])).rows[0].revision;
    const settleIdentity=syntheticCloseAccountSnapshotV2({id:settleAccount.id,branchId:"1",kind:"CUSTODY",holderId:"10",closed:false,revision:settleRevision});
    const withSettlement=syntheticClosePendingSnapshot(settleIdentity,[],[settlement.id]);
    assert.equal(await readPending(settleAccount.id),withSettlement);
    const otherCount=await requestCountFromHolder(db,"1",{requestId:randomUUID(),accountId:otherAccount.id,reason:"جرد حساب آخر اصطناعي"});
    assert.equal(await readPending(settleAccount.id),withSettlement,"open requests for another account are not included");
    const cancelSettleInput={requestId:randomUUID(),settlementId:settlement.id,reason:"إلغاء تسوية اصطناعي"};
    assert.equal((await cancelSettlement(db,"10",cancelSettleInput)).replayed,false);
    assert.equal((await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[settleAccount.id])).rows[0].revision,settleRevision);
    assert.equal(await readPending(settleAccount.id),syntheticClosePendingSnapshot(settleIdentity,[],[]));
    assert.notEqual(await readPending(settleAccount.id),withSettlement);
    assert.deepEqual(await cancelSettlement(db,"10",cancelSettleInput),{id:settlement.id,replayed:true});
    assert.deepEqual(await requestSettlement(db,"10",settlementInput),{id:settlement.id,replayed:true});
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[settleAccount.id])).rows[0].n,0);
    await cancelCashCount(db,"1",{requestId:randomUUID(),countId:otherCount.id,reason:"إلغاء جرد اصطناعي"});
    // Counterexample: a direct non-cooperating synthetic SQL writer can
    // insert two offsetting entries without bumping the account revision.
    const untracked=await open("8");
    const untrackedRevision=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[untracked.id])).rows[0].revision;
    const untrackedInput={requestId:randomUUID(),accountId:untracked.id,reason:"كاتب غير ملتزم اصطناعي",reviewVersion:2,expectedAccountSnapshot:syntheticCloseAccountSnapshotV2({id:untracked.id,branchId:"1",kind:"CUSTODY",holderId:"8",closed:false,revision:untrackedRevision})};
    await pg.query(`INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,actor_id)
      VALUES('TRANSFER',1,$1::bigint,$2::bigint,5,1),('TRANSFER',1,$2::bigint,$1::bigint,5,1)`,[vault.id,untracked.id]);
    assert.equal((await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[untracked.id])).rows[0].revision,untrackedRevision);
    assert.equal((await reviewedCloseTestOnly(db,"1",untrackedInput)).replayed,false,"revision check cannot detect non-cooperating equal movements");
  } finally { if(client)await client.$disconnect(); if(pg)await pg.close();rmSync(dir,{recursive:true,force:true}); }
});
