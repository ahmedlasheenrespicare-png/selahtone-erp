import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openAccount } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase } from "../src/lib/finance/types";

const request = () => ({ requestId:randomUUID(), branchId:"1", kind:"VAULT", holderId:null, openingAmount:"0", openingDate:"2026-10-20", counted:true });
const conflict = (code:string, nested=false) => ({ code:"P2010", meta:nested ? {driverAdapterError:{cause:{originalCode:code}}} : {code} });

test("finance write and duplicate recovery bound recognized transaction conflict retries", async () => {
  for (const error of [{code:"P2034"},{code:"40001"},{code:"40P01"},conflict("40001"),conflict("40P01",true)]) {
    let attempts=0;
    const db:FinanceDatabase={serializable:async()=>{attempts++;throw error;}};
    await assert.rejects(()=>openAccount(db,"1",request(),"2026-10-29"), (e:unknown)=>e instanceof FinanceProblem && e.code==="concurrency");
    assert.equal(attempts,4);
    let calls=0;
    const recovery:FinanceDatabase={serializable:async()=>{calls++;throw calls%2 ? {code:"23505"} : error;}};
    await assert.rejects(()=>openAccount(recovery,"1",request(),"2026-10-29"), (e:unknown)=>e instanceof FinanceProblem && e.code==="concurrency");
    assert.equal(calls,8);
  }
  for (const error of [conflict("23514"),{code:"other",meta:{code:"40001"}}]) {
    let attempts=0;
    const db:FinanceDatabase={serializable:async()=>{attempts++;throw error;}};
    await assert.rejects(()=>openAccount(db,"1",request(),"2026-10-29"), (e:unknown)=>e===error);
    assert.equal(attempts,1);
  }
});
