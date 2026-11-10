/** Pure identity experiment only; no production integration or physical proof. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { MoneyMovementInput } from "../src/lib/commerce-validation";
import { vaultReceiptIdentityTestOnly, vaultReceiptReplayMatchesTestOnly } from "../prototypes/finance-collection-policy/vault-receipt-identity.test-only";

test("synthetic vault receipt identity binds explicit consent without upgrading legacy replays", () => {
  const input: MoneyMovementInput = { requestId: randomUUID(), saleId: "3", amount: "19", method: "CASH", actuallyPaid: false, accountId: null, negativeAcknowledged: false };
  const legacy = vaultReceiptIdentityTestOnly(1n,input,{});
  const oldHash = createHash("sha256").update(JSON.stringify({ actorId: "1", type: "COLLECTION", ...input })).digest("hex");
  assert.equal(legacy.baseHash, oldHash);
  assert.equal(legacy.reviewedHash, null);
  const old = { createdById: 1n, requestHash: oldHash };
  assert.equal(vaultReceiptReplayMatchesTestOnly(old,1n,legacy),true, "matching legacy command may replay without invented receipt");
  const reviewed = vaultReceiptIdentityTestOnly(1n,input,{vaultReceived:true});
  assert.ok(reviewed.reviewedHash);
  assert.notEqual(reviewed.reviewedHash, oldHash);
  assert.equal(vaultReceiptReplayMatchesTestOnly(old,1n,reviewed),false,"adding consent cannot upgrade a legacy command");
  const fresh = { createdById: 1n, requestHash: reviewed.reviewedHash };
  assert.equal(vaultReceiptReplayMatchesTestOnly(fresh,1n,reviewed),true);
  assert.equal(vaultReceiptReplayMatchesTestOnly(fresh,1n,legacy),false,"omitting consent cannot replay an attested command");
  assert.equal(vaultReceiptReplayMatchesTestOnly(fresh,2n,vaultReceiptIdentityTestOnly(2n,input,{vaultReceived:true})),false);
  assert.equal(vaultReceiptReplayMatchesTestOnly(fresh,1n,vaultReceiptIdentityTestOnly(1n,{...input,amount:"20"},{vaultReceived:true})),false);
  assert.equal(vaultReceiptReplayMatchesTestOnly(fresh,1n,vaultReceiptIdentityTestOnly(1n,{...input,saleId:"4"},{vaultReceived:true})),false);
  assert.equal(vaultReceiptReplayMatchesTestOnly(fresh,1n,vaultReceiptIdentityTestOnly(1n,{...input,requestId:randomUUID()},{vaultReceived:true})),false);
  for (const raw of [{vaultReceived:false},{vaultReceived:null},{vaultReceived:"true"},Object.create({vaultReceived:true}),null,[]]) {
    const candidate = vaultReceiptIdentityTestOnly(1n,input,raw);
    assert.equal(candidate.reviewedHash,null,"only an own boolean true can produce the reviewed hash");
    assert.equal(vaultReceiptReplayMatchesTestOnly(fresh,1n,candidate),false);
  }
  assert.equal(vaultReceiptReplayMatchesTestOnly(old,1n,vaultReceiptIdentityTestOnly(1n,input,{vaultReceived:false})),false,"explicit invalid receipt is not a legacy replay");
});

test("initial-sale vault identities preserve old replay for both sale paths", async () => {
  const {parseSaleInput}=await import("../src/lib/commerce-validation");
  const {parseCatalogSaleInput}=await import("../src/lib/catalog-validation");
  const {vaultInitialIdentityTestOnly:identity,vaultInitialReplayMatchesTestOnly:matches}=await import("../prototypes/finance-collection-policy/vault-initial-identity.test-only");
  const shared={requestId:randomUUID(),customerName:"عميل اصطناعي",customerPhone:"01000000000",discount:"0",initialPayment:"7",method:"CASH"};
  const stock=parseSaleInput({...shared,warehouseId:"1",lines:[{productId:"2",quantity:"1",serialIds:[],expectedUnitPrice:"45",expectedTaxRateId:"3",expectedTaxKind:"VAT",expectedTaxRate:"14"}]});
  const catalog=parseCatalogSaleInput({...shared,branchId:"1",lines:[{typeId:"2",quantity:"1",unitPrice:"45",details:[]}]});
  assert.ok(stock.ok);assert.ok(catalog.ok);
  for (const sale of [{kind:"STOCK" as const,input:stock.value},{kind:"CATALOG" as const,input:catalog.value}]) {
    const legacy=identity(1n,sale,{});
    assert.equal(legacy.baseHash,createHash("sha256").update(JSON.stringify({actorId:"1",...sale.input})).digest("hex"));
    const old={createdById:1n,requestHash:legacy.baseHash};
    const reviewed=identity(1n,sale,{vaultReceived:true});
    assert.ok(reviewed.reviewedHash);assert.notEqual(reviewed.reviewedHash,legacy.baseHash);
    const fresh={createdById:1n,requestHash:reviewed.reviewedHash};
    assert.equal(matches(old,1n,legacy),true); assert.equal(matches(old,1n,reviewed),false);
    assert.equal(matches(fresh,1n,reviewed),true);assert.equal(matches(fresh,1n,legacy),false);
    assert.equal(matches(fresh,2n,identity(2n,sale,{vaultReceived:true})),false);
    for(const raw of [{vaultReceived:false},{vaultReceived:null},{vaultReceived:"true"},Object.create({vaultReceived:true})]) {
      assert.equal(identity(1n,sale,raw).reviewedHash,null);
      assert.equal(matches(fresh,1n,identity(1n,sale,raw)),false);
    }
    assert.equal(matches(old,1n,identity(1n,sale,{vaultReceived:false})),false,"invalid explicit receipt is not a legacy replay");
    const changed={...sale,input:{...sale.input,initialPayment:"8"}} as typeof sale;
    assert.equal(matches(fresh,1n,identity(1n,changed,{vaultReceived:true})),false);
    const card={...sale,input:{...sale.input,method:"CARD" as const}} as typeof sale;
    assert.equal(identity(1n,card,{vaultReceived:true}).reviewedHash,null);
  }
});

test("decision sketch separates saved replay from a newly selected route", async () => {
  const {parseSaleInput}=await import("../src/lib/commerce-validation");
  const {vaultInitialIdentityTestOnly}=await import("../prototypes/finance-collection-policy/vault-initial-identity.test-only");
  const {decideInitialReplayTestOnly,decideNewInitialReceiptTestOnly}=await import("../prototypes/finance-collection-policy/vault-initial-decision.test-only");
  const parsed=parseSaleInput({requestId:randomUUID(),warehouseId:"1",customerName:"عميل اصطناعي",customerPhone:"01000000000",discount:"0",initialPayment:"5",method:"CASH",lines:[{productId:"2",quantity:"1",serialIds:[],expectedUnitPrice:"45",expectedTaxRateId:"3",expectedTaxKind:"VAT",expectedTaxRate:"14"}]});
  assert.ok(parsed.ok);
  const sale={kind:"STOCK" as const,input:parsed.value};
  const legacy=vaultInitialIdentityTestOnly(1n,sale,{}), reviewed=vaultInitialIdentityTestOnly(1n,sale,{vaultReceived:true});
  const old={id:"12",createdById:1n,requestHash:legacy.baseHash};
  const fresh={id:"13",createdById:1n,requestHash:reviewed.reviewedHash!};
  assert.deepEqual(decideInitialReplayTestOnly(old,1n,legacy),{kind:"replay",id:"12"});
  assert.deepEqual(decideInitialReplayTestOnly(old,1n,reviewed),{kind:"conflict"});
  assert.deepEqual(decideInitialReplayTestOnly(fresh,1n,legacy),{kind:"conflict"});
  assert.deepEqual(decideInitialReplayTestOnly(fresh,1n,reviewed),{kind:"replay",id:"13"});
  assert.deepEqual(decideInitialReplayTestOnly(fresh,2n,reviewed),{kind:"conflict"});
  assert.deepEqual(decideInitialReplayTestOnly(null,1n,reviewed),{kind:"new"});
  assert.deepEqual(decideNewInitialReceiptTestOnly(legacy,"VAULT"),{kind:"receipt_required"});
  assert.deepEqual(decideNewInitialReceiptTestOnly(reviewed,"VAULT"),{kind:"allowed",requestHash:reviewed.reviewedHash});
  assert.deepEqual(decideNewInitialReceiptTestOnly(legacy,"CUSTODY"),{kind:"allowed",requestHash:legacy.baseHash});
  assert.deepEqual(decideNewInitialReceiptTestOnly(legacy,"NON_CASH"),{kind:"route_mismatch"});
  assert.deepEqual(decideNewInitialReceiptTestOnly(reviewed,"CUSTODY"),{kind:"unexpected_receipt"});
  assert.deepEqual(decideNewInitialReceiptTestOnly(vaultInitialIdentityTestOnly(1n,sale,{vaultReceived:false}),"VAULT"),{kind:"receipt_required"});
  const card={kind:"STOCK" as const,input:{...parsed.value,method:"CARD" as const}};
  assert.deepEqual(decideNewInitialReceiptTestOnly(vaultInitialIdentityTestOnly(1n,card,{vaultReceived:true}),"VAULT"),{kind:"route_mismatch"});
  const cardIdentity=vaultInitialIdentityTestOnly(1n,card,{});
  assert.deepEqual(decideNewInitialReceiptTestOnly(cardIdentity,"NON_CASH"),{kind:"allowed",requestHash:cardIdentity.baseHash});
  assert.deepEqual(decideNewInitialReceiptTestOnly(vaultInitialIdentityTestOnly(1n,card,{vaultReceived:true}),"NON_CASH"),{kind:"unexpected_receipt"});
});
