import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import { addExpenseAttachment, getExpenseAttachment, listExpenseAttachments, openAccount, addCategory, editCategory, createExpense, editUnpaidExpense, approveExpense, payExpense, requestPaidExpenseReview, transferCash, listAccounts, listCategories, listExpenses, listPaidExpenseReviews, listExpenseAudit, listAccountActivity, postCashCollectionInTransaction, postCashRefundInTransaction } from "../prototypes/finance-engine/engine";
import { inspectAttachment, MAX_ATTACHMENT_BYTES } from "../prototypes/finance-engine/attachment-validation";

const schema = readFileSync("prototypes/finance-engine/schema.test-only.sql", "utf8");
const today = "2026-10-29";
const req = () => randomUUID();
function adapter(pg: PGlite): FinanceDatabase {
  return { serializable: (work) => pg.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const executor: FinanceTransaction = { query: async (sql, parameters = []) => ({ rows: (await tx.query(sql, parameters)).rows as never[] }) };
    return work(executor);
  }) };
}
async function rejectsCode(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (err: unknown) => err instanceof FinanceProblem && err.code === code, `expected FinanceProblem ${code}`);
}
function account(branchId: string, kind: "VAULT" | "CUSTODY", holderId: string | null, amount: string, extra: Record<string, unknown> = {}) {
  return { requestId: req(), branchId, kind, holderId, openingAmount: amount, openingDate: "2026-10-20", counted: true, ...extra };
}
function expense(categoryId: string, extra: Record<string, unknown> = {}) {
  return { requestId: req(), branchId: "1", categoryId, amount: "114.00", expenseDate: "2026-10-19", description: "مصروف تجريبي", beneficiary: "جهة اختبار", documentNumber: "DEMO-1", taxAmount: "14.00", ...extra };
}
function approval(expenseId: string, expectedRevision = "1") { return { requestId: req(), expenseId, expectedRevision }; }
function payment(expenseId: string, extra: Record<string, unknown> = {}) {
  return { requestId: req(), expenseId, expectedRevision: "2", method: "CASH", accountId: "1", paymentDate: "2026-10-21", actuallyPaid: true, expectedBalance: "1000.00", ...extra };
}
async function amount(db: FinanceDatabase, accountId: string): Promise<string> { return (await listAccounts(db, "1")).find(a=>a.id===accountId)!.balance; }

// Signature checking is intentionally not malware scanning or an upload endpoint.
test("attachment metadata guard accepts a single small PDF/JPG/PNG signature and rejects mismatches", () => {
  const pdf = new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31]);
  assert.deepEqual(inspectAttachment("bill.pdf","application/pdf",pdf), { filename:"bill.pdf",mediaType:"application/pdf",size:6 });
  assert.equal(inspectAttachment("photo.jpg","image/jpeg",new Uint8Array([0xff,0xd8,0xff,0x01,0x02])).size,5);
  assert.equal(inspectAttachment("photo.png","image/png",new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])).size,8);
  const atLimit = new Uint8Array(MAX_ATTACHMENT_BYTES); atLimit.set(pdf); assert.equal(inspectAttachment("limit.pdf","application/pdf",atLimit).size, MAX_ATTACHMENT_BYTES);
  for (const args of [["../file.pdf","application/pdf",pdf], ["bad\nname.pdf","application/pdf",pdf], ["bad\u202ename.pdf","application/pdf",pdf], ["bill.jpg","image/jpeg",pdf], ["bill.pdf","application/pdf",new Uint8Array(MAX_ATTACHMENT_BYTES+1)], ["bill.svg","image/svg+xml",pdf]] as const) {
    assert.throws(()=>inspectAttachment(args[0],args[1],args[2]), (e:unknown)=>e instanceof FinanceProblem && e.code==="invalid_attachment");
  }
});

test("exhausted serialization retries become a safe concurrency error", async () => {
  for (const code of ["40001","40P01"]) {
    let attempts=0;
    const db:FinanceDatabase={serializable:async()=>{attempts++;throw Object.assign(new Error("test conflict"),{code});}};
    await rejectsCode(()=>openAccount(db,"1",account("1","VAULT",null,"0"),today),"concurrency");assert.equal(attempts,4);
  }
  let reads=0;
  const retryingRead:FinanceDatabase={serializable:async()=>{reads++;throw Object.assign(new Error("test conflict"),{code:reads%2?"23505":"40001"});}};
  await rejectsCode(()=>openAccount(retryingRead,"1",account("1","VAULT",null,"0"),today),"concurrency");assert.equal(reads,8);
});

test("test-only lab refuses schema setup without explicit session opt-in", async () => {
  const pg = new PGlite();
  try {
    await assert.rejects(()=>pg.exec(schema), /test database only/);
    const result = await pg.query<{ present: string | null }>("SELECT to_regnamespace('finance_lab')::text AS present");
    assert.equal(result.rows[0].present,null);
  } finally { await pg.close(); }
});

test("finance lab operations on an isolated in-memory PostgreSQL database", { timeout:120_000 }, async t => {
  const pg = new PGlite();
  try {
    await pg.exec("SET selahtone.finance_lab_test_only = 'yes'"); await pg.exec(schema);
    await pg.exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) VALUES(1,'فرع تجريبي',TRUE),(2,'فرع آخر',TRUE),(3,'فرع متوقف',FALSE);
      INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name) VALUES
      (1,NULL,'MANAGER','ACTIVE',FALSE,'مدير'),(2,NULL,'ACCOUNTANT','ACTIVE',FALSE,'محاسب'),
      (3,1,'CS_AGENT','ACTIVE',FALSE,'موظف أول'),(4,1,'CS_AGENT','ACTIVE',FALSE,'موظف ثان'),
      (5,2,'CS_AGENT','ACTIVE',FALSE,'موظف فرع آخر'),(6,1,'CS_AGENT','SUSPENDED',FALSE,'موقوف'),
      (7,NULL,'MANAGER','ACTIVE',TRUE,'مطلوب تغيير كلمة المرور');`);
    const db = adapter(pg);
    let vault1 = "", custody1 = "", custody2 = "", vault2 = "", categoryId = "";
    await t.test("opening requires actual count, nonnegative amount, correct holder and manager/accountant", async () => {
      await rejectsCode(()=>openAccount(db,"3",account("1","VAULT",null,"0"),today),"forbidden");
      await rejectsCode(()=>openAccount(db,"7",account("1","VAULT",null,"0"),today),"forbidden");
      await rejectsCode(()=>openAccount(db,"1",account("1","VAULT",null,"-1"),today),"invalid_input");
      await rejectsCode(()=>openAccount(db,"1",account("1","VAULT",null,"1",{ counted:false }),today),"invalid_input");
      await rejectsCode(()=>openAccount(db,"1",account("1","VAULT",null,"1",{ openingDate:"2026-10-30" }),today),"future_date");
      await rejectsCode(()=>openAccount(db,"1",account("1","VAULT",null,"1",{ openingDate:"0000-01-01" }),today),"invalid_input");
      await rejectsCode(()=>openAccount(db,"1",account("3","VAULT",null,"0"),today),"branch_unavailable");
      await rejectsCode(()=>openAccount(db,"2",account("1","CUSTODY","5","0"),today),"holder_unavailable");
      const first = account("1","VAULT",null,"1000.00");
      const created=await openAccount(db,"1",first,today); vault1=created.id;
      assert.equal((await openAccount(db,"1",first,today)).replayed,true);
      await rejectsCode(()=>openAccount(db,"1",{...first,openingAmount:"999"},today),"request_conflict");
      await rejectsCode(()=>openAccount(db,"2",first,today),"request_conflict");
      await rejectsCode(()=>openAccount(db,"2",account("1","VAULT",null,"1"),today),"duplicate");
      custody1=(await openAccount(db,"2",account("1","CUSTODY","3","200"),today)).id;
      custody2=(await openAccount(db,"2",account("1","CUSTODY","4","0"),today)).id;
      vault2=(await openAccount(db,"1",account("2","VAULT",null,"300"),today)).id;
      assert.equal(await amount(db,custody2),"0.00");
    });
    await t.test("manager/accountant categories preserve old snapshots and deactivation blocks new use", async () => {
      const category={requestId:req(),name:"صيانة تجريبية"};categoryId=(await addCategory(db,"2",category)).id;
      assert.equal((await addCategory(db,"2",category)).replayed,true);
      await rejectsCode(()=>addCategory(db,"3",{requestId:req(),name:"ممنوع"}),"forbidden");
      const old=await createExpense(db,"1",expense(categoryId));
      await rejectsCode(()=>editCategory(db,"1",{requestId:req(),categoryId,expectedRevision:"1",name:"صيانة معدلة",active:false,reason:""}),"invalid_input");
      await rejectsCode(()=>editCategory(db,"3",{requestId:req(),categoryId,expectedRevision:"1",name:"صيانة معدلة",active:false,reason:"إيقاف"}),"forbidden");
      await editCategory(db,"1",{requestId:req(),categoryId,expectedRevision:"1",name:"صيانة معدلة",active:false,reason:"توضيح البند وإيقافه"});
      await rejectsCode(()=>createExpense(db,"1",expense(categoryId)),"category_inactive");
      assert.equal((await listCategories(db,"2"))[0].active,false);await rejectsCode(()=>listCategories(db,"3"),"forbidden");
      assert.equal((await listExpenses(db,"1")).find(e=>e.id===old.id)!.categorySnapshot,"صيانة تجريبية");
      const change=await pg.query<{reason:string}>("SELECT reason FROM finance_lab.audit_events WHERE entity_type='CATEGORY' AND action='EDIT' AND entity_id=$1::bigint",[categoryId]);assert.equal(change.rows[0].reason,"توضيح البند وإيقافه");
      await editCategory(db,"2",{requestId:req(),categoryId,expectedRevision:"2",name:"صيانة معدلة",active:true,reason:"إعادة تفعيل"});
      await rejectsCode(()=>editCategory(db,"1",{requestId:req(),categoryId,expectedRevision:"1",name:"تغيير قديم",active:true,reason:"تعديل"}),"revision_changed");
    });
    await t.test("fictional attachment is private, limited to one, fingerprinted and rolls back with audit/quota", async () => {
      const item = await createExpense(db,"1",expense(categoryId));
      const file = { name:"فاتورة-وهمية.png", mediaType:"image/png", bytes:new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01]) };
      const input = { requestId:req(), expenseId:item.id };
      await rejectsCode(()=>addExpenseAttachment(db,"3",input,file),"forbidden");
      const saved = await addExpenseAttachment(db,"1",input,file);
      assert.equal((await addExpenseAttachment(db,"1",input,file)).replayed,true);
      await rejectsCode(()=>addExpenseAttachment(db,"1",input,{...file,bytes:new Uint8Array([...file.bytes,0x02])}),"request_conflict");
      await rejectsCode(()=>addExpenseAttachment(db,"2",input,file),"request_conflict");
      await rejectsCode(()=>addExpenseAttachment(db,"2",{requestId:req(),expenseId:item.id},file),"attachment_exists");
      await rejectsCode(()=>listExpenseAttachments(db,"3"),"forbidden");
      await rejectsCode(()=>getExpenseAttachment(db,"3",item.id),"forbidden");
      const list = await listExpenseAttachments(db,"2"), metadata = list.find(row=>row.expenseId===item.id)!;
      assert.equal(metadata.id,saved.id); assert.equal(metadata.size,file.bytes.byteLength); assert(!("bytes" in metadata));
      const stored = await getExpenseAttachment(db,"2",item.id); assert.deepEqual(stored?.bytes,file.bytes); assert.equal(stored?.filename,file.name);
      assert.equal((await listExpenseAudit(db,"1",item.id)).filter(row=>row.action==="ATTACH").length,1);
      const budget = await pg.query<{used_bytes:number;used_count:number}>("SELECT used_bytes,used_count FROM finance_lab.attachment_quota");
      assert.deepEqual(budget.rows[0],{used_bytes:file.bytes.byteLength,used_count:1});
      const withoutFile = await createExpense(db,"1",expense(categoryId)); const failed = {requestId:req(),expenseId:withoutFile.id};
      await pg.exec(`CREATE FUNCTION finance_lab.reject_attachment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ATTACH' THEN RAISE EXCEPTION 'late attachment rejection'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_attachment_audit BEFORE INSERT ON finance_lab.audit_events FOR EACH ROW EXECUTE FUNCTION finance_lab.reject_attachment_audit();`);
      try { await assert.rejects(()=>addExpenseAttachment(db,"1",failed,file),/late attachment rejection/); }
      finally { await pg.exec("DROP TRIGGER reject_attachment_audit ON finance_lab.audit_events; DROP FUNCTION finance_lab.reject_attachment_audit()"); }
      assert.equal(await getExpenseAttachment(db,"1",withoutFile.id),null);
      assert.deepEqual((await pg.query("SELECT used_bytes,used_count FROM finance_lab.attachment_quota")).rows,budget.rows);
      assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.requests WHERE request_id=$1::uuid",[failed.requestId])).rows[0].n,0);
      await pg.query("UPDATE finance_lab.expense_attachments SET bytes=$1::bytea WHERE expense_id=$2::bigint",[Buffer.from([...file.bytes,0x03]),item.id]);
      await rejectsCode(()=>getExpenseAttachment(db,"1",item.id),"attachment_corrupt");
      await pg.query("UPDATE finance_lab.expense_attachments SET bytes=$1::bytea WHERE expense_id=$2::bigint",[Buffer.from(file.bytes),item.id]);
      await pg.exec("UPDATE finance_lab.attachment_quota SET used_count=20 WHERE singleton=1");
      await rejectsCode(()=>addExpenseAttachment(db,"1",failed,file),"attachment_quota");
      await pg.exec("UPDATE finance_lab.attachment_quota SET used_count=1 WHERE singleton=1");
      assert.deepEqual((await getExpenseAttachment(db,"1",item.id))?.bytes,file.bytes);
    });
    await t.test("expense data, tax null/zero, self-approval, reapproval and noncash payment", async () => {
      const before=await amount(db,vault1);
      await rejectsCode(()=>createExpense(db,"3",expense(categoryId)),"forbidden");
      await rejectsCode(()=>createExpense(db,"1",expense(categoryId,{taxAmount:"200"})),"invalid_input");
      const input=expense(categoryId,{taxAmount:""});const saved=await createExpense(db,"1",input);
      assert.equal((await createExpense(db,"1",input)).replayed,true);
      let current=(await listExpenses(db,"2")).find(e=>e.id===saved.id)!;assert.equal(current.taxAmount,null);assert.equal(current.status,"PENDING");
      await approveExpense(db,"1",approval(saved.id));current=(await listExpenses(db,"1")).find(e=>e.id===saved.id)!;assert.equal(current.approvedBy,"1");assert.equal(current.revision,2);assert.equal(await amount(db,vault1),before);
      const edited={...expense(categoryId,{taxAmount:"0",description:"وصف مصحح"}),expenseId:saved.id,expectedRevision:"2",reason:"تصحيح وصف"};
      await editUnpaidExpense(db,"2",edited);current=(await listExpenses(db,"1")).find(e=>e.id===saved.id)!;assert.equal(current.status,"PENDING");assert.equal(current.approvedBy,null);assert.equal(current.taxAmount,"0.00");assert.equal(current.revision,3);
      const audits=await listExpenseAudit(db,"2",saved.id);const edit=audits.find(row=>row.action==="EDIT")!;
      assert.equal((edit.beforeData as {approvedBy:string}).approvedBy,"1");assert.ok((edit.beforeData as {approvedAt:string}).approvedAt);assert.equal(edit.reason,"تصحيح وصف");
      await rejectsCode(()=>listExpenseAudit(db,"3",saved.id),"forbidden");
      await approveExpense(db,"2",approval(saved.id,"3"));
      const cashless=payment(saved.id,{expectedRevision:"4",method:"CARD",accountId:null,expectedBalance:null,paymentDate:"2026-10-21"});
      const paid=await payExpense(db,"2",cashless,today);assert.equal((await payExpense(db,"2",cashless,today)).id,paid.id);
      await rejectsCode(()=>payExpense(db,"2",{...cashless,method:"WALLET"},today),"request_conflict");
      const paidRow=(await listExpenses(db,"2")).find(e=>e.id===saved.id)!;
      assert.equal(paidRow.paymentId,paid.id);assert.equal(paidRow.paymentMethod,"CARD");assert.equal(paidRow.paymentAmount,"114.00");assert.equal(paidRow.paymentRecordedBy,"2");
      assert.equal(paidRow.paymentDate,"2026-10-21");assert.ok(paidRow.paymentRecordedAt);assert.ok(paidRow.createdAt);assert.ok(paidRow.approvedAt);assert.equal(paidRow.paymentAccountId,null);
      assert.equal(await amount(db,vault1),before);assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.movements")).rows[0].n,0);
      await rejectsCode(()=>editUnpaidExpense(db,"1",{...edited,requestId:req(),expectedRevision:"5"}),"paid_correction_not_designed");
    });
    await t.test("cash paid before the counted opening is recorded historically; same-day ordering is explicit", async () => {
      const makeApproved=async()=>{const e=await createExpense(db,"1",expense(categoryId,{amount:"50",taxAmount:""}));await approveExpense(db,"1",approval(e.id));return e.id;};
      const id=await makeApproved(), pre=payment(id,{accountId:vault1,paymentDate:"2026-10-19",expectedBalance:null});
      await rejectsCode(()=>payExpense(db,"1",pre,today),"historical_confirmation");
      const oldBalance=await amount(db,vault1);const paid=await payExpense(db,"1",{...pre,includedInOpening:true},today);
      const record=await pg.query<{historical:boolean;payment_date:string}>(`SELECT historical,payment_date::text FROM finance_lab.payments WHERE id=$1::bigint`,[paid.id]);
      assert.equal(record.rows[0].historical,true);assert.equal(record.rows[0].payment_date,"2026-10-19");assert.equal(await amount(db,vault1),oldBalance);
      const historical=(await listExpenses(db,"1")).find(e=>e.id===id)!;assert.equal(historical.paymentHistorical,true);assert.equal(historical.paymentAccountId,vault1);
      const recorded=(await listExpenseAudit(db,"1",id)).find(row=>row.action==="PAY")!;assert.equal((recorded.afterData as {includedInOpening:boolean}).includedInOpening,true);
      const same=await makeApproved(),sameInput=payment(same,{accountId:vault1,paymentDate:"2026-10-20",expectedBalance:null});
      await rejectsCode(()=>payExpense(db,"1",sameInput,today),"opening_order_required");
      await rejectsCode(()=>payExpense(db,"1",{...sameInput,openingOrder:"BEFORE"},today),"historical_confirmation");
      await payExpense(db,"1",{...sameInput,openingOrder:"BEFORE",includedInOpening:true},today);assert.equal(await amount(db,vault1),oldBalance);
      const after=await makeApproved();await payExpense(db,"1",payment(after,{accountId:vault1,paymentDate:"2026-10-20",openingOrder:"AFTER",expectedBalance:oldBalance}),today);
      assert.equal(await amount(db,vault1),"950.00");
    });
    await t.test("transfers are same-branch vault/custody, atomic, reviewed and conserve total cash", async () => {
      const base={requestId:req(),fromId:vault1,toId:custody1,amount:"1000",expectedBalance:"950",actuallyTransferred:true,negativeAcknowledged:false};
      await rejectsCode(()=>transferCash(db,"3",base),"forbidden");
      await rejectsCode(()=>transferCash(db,"1",{...base,toId:vault2}),"invalid_transfer");
      await rejectsCode(()=>transferCash(db,"1",{...base,fromId:custody1,toId:custody2,expectedBalance:"200"}),"invalid_transfer");
      await rejectsCode(()=>transferCash(db,"1",base),"negative_warning");
      await rejectsCode(()=>transferCash(db,"1",{...base,expectedBalance:"949",negativeAcknowledged:true}),"balance_changed");
      const before=(await listAccounts(db,"1")).reduce((sum,a)=>sum+BigInt(a.balance.replace(".","")),0n);
      const confirmed={...base,negativeAcknowledged:true};const moved=await transferCash(db,"2",confirmed);
      assert.equal((await transferCash(db,"2",confirmed)).replayed,true);
      await rejectsCode(()=>transferCash(db,"2",{...confirmed,amount:"900"}),"request_conflict");
      assert.equal(await amount(db,vault1),"-50.00");assert.equal(await amount(db,custody1),"1200.00");
      const after=(await listAccounts(db,"1")).reduce((sum,a)=>sum+BigInt(a.balance.replace(".","")),0n);assert.equal(after,before);
      const entries=await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.movements WHERE id=$1::bigint",[moved.id]);assert.equal(entries.rows[0].n,1);
    });
    await t.test("cash hook is atomic with its source event, scoped and unique; caller must verify an actual refund", async () => {
      await pg.exec("CREATE TABLE finance_lab.fake_sales(id BIGINT PRIMARY KEY)");
      await assert.rejects(()=>db.serializable(async tx=>{await tx.query("INSERT INTO finance_lab.fake_sales VALUES(1)");await postCashCollectionInTransaction(tx,"3",{branchId:"1",accountId:custody1,amount:"100",collectionId:"101"});throw new Error("simulate failure after both writes");}),/simulate failure/);
      assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.fake_sales")).rows[0].n,0);assert.equal(await amount(db,custody1),"1200.00");
      await db.serializable(tx=>postCashCollectionInTransaction(tx,"3",{branchId:"1",accountId:custody1,amount:"100",collectionId:"101"}));
      await db.serializable(tx=>postCashCollectionInTransaction(tx,"3",{branchId:"1",accountId:vault1,amount:"20",collectionId:"102"}));
      assert.equal(await amount(db,custody1),"1300.00");assert.equal(await amount(db,vault1),"-30.00");
      await rejectsCode(()=>db.serializable(tx=>postCashCollectionInTransaction(tx,"3",{branchId:"1",accountId:custody2,amount:"1",collectionId:"103"})),"forbidden");
      await rejectsCode(()=>db.serializable(tx=>postCashCollectionInTransaction(tx,"3",{branchId:"2",accountId:vault2,amount:"1",collectionId:"104"})),"forbidden");
      await assert.rejects(()=>db.serializable(tx=>postCashCollectionInTransaction(tx,"3",{branchId:"1",accountId:vault1,amount:"20",collectionId:"102"})));
      assert.equal(await amount(db,vault1),"-30.00");
      await rejectsCode(()=>db.serializable(tx=>postCashRefundInTransaction(tx,"3",{branchId:"1",accountId:vault1,amount:"5",refundId:"201",expectedBalance:"-30",negativeAcknowledged:true})),"forbidden");
      await rejectsCode(()=>db.serializable(tx=>postCashRefundInTransaction(tx,"2",{branchId:"1",accountId:vault1,amount:"5",refundId:"201",expectedBalance:"-30",negativeAcknowledged:false})),"negative_warning");
      await db.serializable(tx=>postCashRefundInTransaction(tx,"2",{branchId:"1",accountId:vault1,amount:"5",refundId:"201",expectedBalance:"-30",negativeAcknowledged:true}));assert.equal(await amount(db,vault1),"-35.00");
    });
    await t.test("inactive branch cash hooks permit only management to settle through same-branch accounts", async () => {
      await pg.exec("UPDATE finance_lab.branches SET is_active=false WHERE id=2");
      try {
        await rejectsCode(()=>db.serializable(tx=>postCashCollectionInTransaction(tx,"5",{branchId:"2",accountId:vault2,amount:"10",collectionId:"801"})),"forbidden");
        await db.serializable(tx=>postCashCollectionInTransaction(tx,"1",{branchId:"2",accountId:vault2,amount:"10",collectionId:"801"}));
        assert.equal(await amount(db,vault2),"310.00");
        await rejectsCode(()=>db.serializable(tx=>postCashCollectionInTransaction(tx,"2",{branchId:"2",accountId:vault1,amount:"1",collectionId:"802"})),"forbidden");
        await db.serializable(tx=>postCashRefundInTransaction(tx,"2",{branchId:"2",accountId:vault2,amount:"5",refundId:"803",expectedBalance:"310",negativeAcknowledged:false}));
        assert.equal(await amount(db,vault2),"305.00");
        await rejectsCode(()=>openAccount(db,"1",account("2","CUSTODY","5","0"),today),"branch_unavailable");
      } finally { await pg.exec("UPDATE finance_lab.branches SET is_active=true WHERE id=2"); }
    });
    await t.test("a late database failure rolls back payment, cash movement, status and idempotency together", async () => {
      await pg.exec(`CREATE FUNCTION finance_lab.reject_payment_movement() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.kind='EXPENSE' AND NEW.amount=42 THEN RAISE EXCEPTION 'test rejection'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER lab_reject_payment BEFORE INSERT ON finance_lab.movements FOR EACH ROW EXECUTE FUNCTION finance_lab.reject_payment_movement();`);
      try {
        const saved=await createExpense(db,"1",expense(categoryId,{amount:"42",taxAmount:""})); await approveExpense(db,"1",approval(saved.id));
        const before=await amount(db,custody1), attempt=payment(saved.id,{accountId:custody1,expectedBalance:before});
        await assert.rejects(()=>payExpense(db,"1",attempt,today),/test rejection/);
        assert.equal(await amount(db,custody1),before);
        const row=(await listExpenses(db,"1")).find(e=>e.id===saved.id)!;assert.equal(row.status,"APPROVED");assert.equal(row.revision,2);
        const payments=await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.payments WHERE expense_id=$1::bigint",[saved.id]);assert.equal(payments.rows[0].n,0);
        const requests=await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.requests WHERE request_id=$1::uuid",[attempt.requestId]);assert.equal(requests.rows[0].n,0);
        const auditRows=await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.audit_events WHERE entity_type='EXPENSE' AND entity_id=$1::bigint AND action='PAY'",[saved.id]);assert.equal(auditRows.rows[0].n,0);
      } finally { await pg.exec("DROP TRIGGER lab_reject_payment ON finance_lab.movements; DROP FUNCTION finance_lab.reject_payment_movement()"); }
    });
    await t.test("paid-expense mistakes are queued for manual review without changing any cash or original record", async () => {
      const item=await createExpense(db,"1",expense(categoryId,{amount:"120",taxAmount:"",description:"خطأ تسجيل وهمي"}));
      await approveExpense(db,"1",approval(item.id));
      await payExpense(db,"1",payment(item.id,{accountId:custody1,expectedBalance:await amount(db,custody1)}),today);
      const baseline=await pg.query<{expense:unknown;payment:unknown;account:unknown;movements:unknown}>(`SELECT
        (SELECT to_jsonb(e) FROM finance_lab.expenses e WHERE id=$1::bigint) AS expense,
        (SELECT to_jsonb(p) FROM finance_lab.payments p WHERE expense_id=$1::bigint) AS payment,
        (SELECT to_jsonb(a) FROM finance_lab.accounts a WHERE id=$2::bigint) AS account,
        (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM finance_lab.movements m) AS movements`,[item.id,custody1]);
      const beforeBalance=await amount(db,custody1);
      const review={requestId:req(),expenseId:item.id,expectedRevision:"3",reason:"دُفع 100 وسُجل 120؛ يرجى مراجعة المستند",proposedAmount:"100"};
      await rejectsCode(()=>requestPaidExpenseReview(db,"3",review),"forbidden");
      await rejectsCode(()=>requestPaidExpenseReview(db,"1",{...review,reason:""}),"invalid_input");
      const pending=await createExpense(db,"1",expense(categoryId,{amount:"20",taxAmount:""}));
      await rejectsCode(()=>requestPaidExpenseReview(db,"1",{...review,requestId:req(),expenseId:pending.id,expectedRevision:"1"}),"wrong_status");
      await rejectsCode(()=>requestPaidExpenseReview(db,"1",{...review,expectedRevision:"2"}),"revision_changed");
      const made=await requestPaidExpenseReview(db,"2",review);
      assert.equal((await requestPaidExpenseReview(db,"2",review)).replayed,true);
      await rejectsCode(()=>requestPaidExpenseReview(db,"2",{...review,proposedAmount:"90"}),"request_conflict");
      await rejectsCode(()=>requestPaidExpenseReview(db,"1",{...review,requestId:req()}),"review_exists");
      const reviews=await listPaidExpenseReviews(db,"1");assert.equal(reviews.length,1);assert.equal(reviews[0].id,made.id);
      assert.equal(reviews[0].status,"OPEN");assert.equal(reviews[0].proposedAmount,"100.00");assert.equal(reviews[0].reason,review.reason);assert.equal(reviews[0].createdBy,"2");
      const snapshot=reviews[0].originalSnapshot as {expense:{amount:string;status:string};payment:{amount:string;accountId:string}};
      assert.equal(snapshot.expense.amount,"120.00");assert.equal(snapshot.expense.status,"PAID");assert.equal(snapshot.payment.amount,"120.00");assert.equal(snapshot.payment.accountId,custody1);
      assert.equal((await listExpenses(db,"2")).find(e=>e.id===item.id)!.hasOpenReview,true);
      await rejectsCode(()=>listPaidExpenseReviews(db,"3"),"forbidden");assert.equal(await amount(db,custody1),beforeBalance);
      const after=await pg.query<{expense:unknown;payment:unknown;account:unknown;movements:unknown}>(`SELECT
        (SELECT to_jsonb(e) FROM finance_lab.expenses e WHERE id=$1::bigint) AS expense,
        (SELECT to_jsonb(p) FROM finance_lab.payments p WHERE expense_id=$1::bigint) AS payment,
        (SELECT to_jsonb(a) FROM finance_lab.accounts a WHERE id=$2::bigint) AS account,
        (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM finance_lab.movements m) AS movements`,[item.id,custody1]);
      assert.deepEqual(after.rows[0],baseline.rows[0]);
      const audits=await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.audit_events WHERE entity_type='EXPENSE_REVIEW' AND entity_id=$1::bigint AND action='CREATE'",[made.id]);assert.equal(audits.rows[0].n,1);
    });
    await t.test("staff sees only their custody and generic debit, never expenses or other accounts", async () => {
      const own=await listAccounts(db,"3");assert.deepEqual(own.map(a=>a.id),[custody1]);
      await rejectsCode(()=>listAccounts(db,"6"),"forbidden");await rejectsCode(()=>listExpenses(db,"3"),"forbidden");
      await rejectsCode(()=>listAccountActivity(db,"3",vault1),"forbidden");await rejectsCode(()=>listAccountActivity(db,"3",custody2),"forbidden");
      const id=(await createExpense(db,"1",expense(categoryId,{amount:"10",description:"بيانات سرية",taxAmount:""}))).id;await approveExpense(db,"1",approval(id));
      await payExpense(db,"1",payment(id,{accountId:custody1,expectedBalance:await amount(db,custody1)}),today);
      const activity=await listAccountActivity(db,"3",custody1);assert.equal(activity[0].kind,"DEBIT");
      assert(activity.every((row,index)=>index===0 || BigInt(activity[index-1].id)>BigInt(row.id)),"movement IDs must sort numerically even past 9");
      assert.deepEqual(Object.keys(activity[0]).sort(),["amount","direction","id","kind","recordedAt"]);assert.ok(activity[0].recordedAt);assert(!JSON.stringify(activity).includes("بيانات سرية"));
      await rejectsCode(()=>listAccountActivity(db,"3","999999"),"forbidden");
    });
  } finally { await pg.close(); }
});
