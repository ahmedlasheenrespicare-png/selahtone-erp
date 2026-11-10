/** Pure laboratory test: no production write or proof of human review. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { syntheticClosePendingSnapshot } from "../prototypes/finance-custody-reopen/pending-snapshot.test-only";
import { syntheticCloseAccountSnapshot, syntheticCloseAccountSnapshotV2, syntheticCloseRequestIdentity, syntheticCloseReplayMatches } from "../prototypes/finance-custody-reopen/close-identity.test-only";

test("synthetic close identity binds account review without upgrading legacy replay", () => {
  const input = { requestId: randomUUID(), accountId: "7", reason: "إقفال تجريبي" };
  const account = { id: "7", branchId: "2", kind: "CUSTODY" as const, holderId: "3", closed: false };
  const snapshot = syntheticCloseAccountSnapshot(account);
  const legacy = syntheticCloseRequestIdentity("1", input, {});
  const actualOldHash = createHash("sha256").update(JSON.stringify({actorId:"1",action:"CLOSE_ACCOUNT",payload:input})).digest("hex");
  assert.equal(legacy.legacyHash,actualOldHash);
  const old = {actorId:"1",action:"CLOSE_ACCOUNT",requestHash:actualOldHash};
  const reviewed = syntheticCloseRequestIdentity("1",input,{expectedAccountSnapshot:snapshot});
  assert.ok(reviewed.reviewedHash); assert.notEqual(reviewed.reviewedHash,actualOldHash);
  const fresh = {actorId:"1",action:"CLOSE_ACCOUNT",requestHash:reviewed.reviewedHash};
  assert.equal(syntheticCloseReplayMatches(old,"1",legacy),true);
  assert.equal(syntheticCloseReplayMatches(old,"1",reviewed),false,"adding review cannot upgrade an old request");
  assert.equal(syntheticCloseReplayMatches(fresh,"1",legacy),false,"dropping review cannot replay a new request");
  assert.equal(syntheticCloseReplayMatches(fresh,"1",reviewed),true);
  assert.equal(syntheticCloseReplayMatches(fresh,"2",syntheticCloseRequestIdentity("2",input,{expectedAccountSnapshot:snapshot})),false);
  assert.equal(syntheticCloseReplayMatches({...fresh,action:"OTHER"},"1",reviewed),false);
  for (const change of [{id:"8"},{branchId:"4"},{kind:"VAULT" as const},{holderId:"4"},{holderId:null},{closed:true}]) {
    const changedSnapshot=syntheticCloseAccountSnapshot({...account,...change});
    assert.notEqual(changedSnapshot,snapshot);
    assert.equal(syntheticCloseReplayMatches(fresh,"1",syntheticCloseRequestIdentity("1",input,{expectedAccountSnapshot:changedSnapshot})),false);
  }
  for (const changed of [{requestId:randomUUID()},{accountId:"8"},{reason:"سبب آخر"},{reason:null}])
    assert.equal(syntheticCloseReplayMatches(fresh,"1",syntheticCloseRequestIdentity("1",{...input,...changed},{expectedAccountSnapshot:snapshot})),false);
  for (const raw of [{expectedAccountSnapshot:null},{expectedAccountSnapshot:""},{expectedAccountSnapshot:false},{expectedAccountSnapshot:"g".repeat(64)},{expectedAccountSnapshot:snapshot.toUpperCase()}]) {
    const candidate=syntheticCloseRequestIdentity("1",input,raw);
    assert.equal(candidate.reviewedHash,null);
    assert.equal(syntheticCloseReplayMatches(old,"1",candidate),false,"invalid supplied review is not legacy replay");
    assert.equal(syntheticCloseReplayMatches(fresh,"1",candidate),false);
  }
  assert.equal(syntheticCloseRequestIdentity("1",input,Object.create({expectedAccountSnapshot:snapshot})).reviewedHash,null,"inherited fields cannot create a review identity");
  const snapshotV2=syntheticCloseAccountSnapshotV2({...account,revision:"0"});
  assert.notEqual(snapshotV2,syntheticCloseAccountSnapshotV2({...account,revision:"1"}));
  const v2=syntheticCloseRequestIdentity("1",input,{reviewVersion:2,expectedAccountSnapshot:snapshotV2});
  assert.ok(v2.reviewedHash); assert.notEqual(v2.reviewedHash,reviewed.reviewedHash);
  assert.equal(syntheticCloseReplayMatches(old,"1",v2),false);
  assert.equal(syntheticCloseReplayMatches(fresh,"1",syntheticCloseRequestIdentity("1",input,{reviewVersion:2,expectedAccountSnapshot:snapshot})),false);
  assert.equal(syntheticCloseReplayMatches(old,"1",syntheticCloseRequestIdentity("1",input,{reviewVersion:2})),false);
  for (const version of [null,1,"2",3,false]) assert.equal(syntheticCloseRequestIdentity("1",input,{reviewVersion:version,expectedAccountSnapshot:snapshotV2}).reviewedHash,null);
  for (const revision of ["-1","00","1.0","", "a"]) assert.throws(()=>syntheticCloseAccountSnapshotV2({...account,revision}),/invalid synthetic account revision/);
  assert.equal(syntheticCloseAccountSnapshot({...account}),snapshot,"returning to the same fields is indistinguishable");
});


test("pending snapshot compares current typed sets, not terminal history", () => {
  const account=syntheticCloseAccountSnapshotV2({id:"7",branchId:"2",kind:"CUSTODY",holderId:"3",closed:false,revision:"1"});
  const open=syntheticClosePendingSnapshot(account,["10","2"],["8"]);
  assert.equal(open,syntheticClosePendingSnapshot(account,["2","10"],["8"]));
  assert.notEqual(open,syntheticClosePendingSnapshot(account,["10"],["8"]));
  assert.notEqual(open,syntheticClosePendingSnapshot(account,["10","2","8"],[]));
  const empty=syntheticClosePendingSnapshot(account,[],[]);
  assert.equal(empty,syntheticClosePendingSnapshot(account,[],[]),"an open-then-cancelled request cannot be recovered from current open IDs");
  for (const ids of [["0"],["01"],["-1"],["1","1"],["x"]]) assert.throws(()=>syntheticClosePendingSnapshot(account,ids,[]));
  assert.throws(()=>syntheticClosePendingSnapshot("bad",[],[]));
});
