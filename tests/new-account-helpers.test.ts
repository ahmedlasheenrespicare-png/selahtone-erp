import { custodyRequestSnapshot } from "../src/lib/finance/custody-request-snapshot";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  decideCustodyRequest,
  openAccount,
  getMyPendingCustodyRequest,
  listAccounts,
  listCustodyRequests,
  requestCustody,
} from "../src/lib/finance/engine";
import {
  buildCustodyDecisionPayload,
  calculateDenominationTotal,
  computeBranchAccountCoverage,
  normalizeAccountMoneyInput,
  parseNonNegativeMoneyCents,
} from "../src/lib/finance/new-account-helpers";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("normalizeAccountMoneyInput and parseNonNegativeMoneyCents accept zero and Arabic digits and reject >2 decimals or negative", () => {
  assert.equal(normalizeAccountMoneyInput("٠"), "0");
  assert.equal(normalizeAccountMoneyInput("١٬٥٠٠٫٥٠"), "1500.50");
  assert.equal(parseNonNegativeMoneyCents("0"), 0n);
  assert.equal(parseNonNegativeMoneyCents("٠٫٠٠"), 0n);
  assert.equal(parseNonNegativeMoneyCents("١٥٠٠٫٢٥"), 150025n);
  assert.equal(parseNonNegativeMoneyCents("-10"), null);
  assert.equal(parseNonNegativeMoneyCents("10.999"), null);
  assert.equal(parseNonNegativeMoneyCents(""), null);
});

test("calculateDenominationTotal sums paper denominations and coins accurately with Arabic digits", () => {
  const res = calculateDenominationTotal(
    {
      200: "٥", // 1000.00
      100: "3", // 300.00
      50: "1", // 50.00
      10: "٢", // 20.00
    },
    "٧٫٥٠", // 7.50
  );
  assert.equal(res.valid, true);
  assert.equal(res.totalBillsCount, 11);
  assert.equal(res.totalCents, 137750n);
  assert.equal(res.totalInputString, "1377.50");
  assert.equal(res.nonZeroItems.length, 4);

  const invalid = calculateDenominationTotal({ 200: "2.5" });
  assert.equal(invalid.valid, false);
});

test("computeBranchAccountCoverage excludes closed custodies from active duplicates and identifies missing vaults", () => {
  const branches = [
    { id: "1", name: "فرع مدينة نصر", code: "BR1" },
    { id: "2", name: "فرع المعادي", code: "BR2" },
  ];
  const staff = [
    { id: "10", name: "أحمد علي", branchId: "1" },
    { id: "11", name: "سارة حسن", branchId: "1" },
    { id: "12", name: "محمود طارق", branchId: "2" },
  ];
  const accounts = [
    {
      id: "100",
      branchId: "1",
      kind: "VAULT" as const,
      holderId: null,
      balance: "5000.00",
      closedAt: null,
    },
    {
      id: "101",
      branchId: "1",
      kind: "CUSTODY" as const,
      holderId: "10",
      balance: "1200.00",
      closedAt: null,
    },
    {
      id: "102",
      branchId: "1",
      kind: "CUSTODY" as const,
      holderId: "11",
      balance: "0.00",
      closedAt: "2026-10-20 14:00:00+00",
    },
  ];

  const cov = computeBranchAccountCoverage(branches, staff, accounts);
  assert.equal(cov.totalActiveBranches, 2);
  assert.equal(cov.openVaultCount, 1);
  assert.deepEqual(
    cov.missingVaultBranches.map((b) => b.id),
    ["2"],
  );
  assert.deepEqual(cov.openCustodyHolderIds, ["10"]);
  // الموظفة سارة (11) عهدتها مقفلة فلا تُحجب عن فتح عهدة جديدة
  assert.equal(cov.openCustodyHolderIds.includes("11"), false);
  assert.deepEqual(cov.closedCustodyHolderIds, ["11"]);
  assert.equal(cov.availableStaffCount, 2);
});

test("buildCustodyDecisionPayload converts counted checkbox to boolean and allows REJECT without physical count", () => {
  const approvedChecked = buildCustodyDecisionPayload({
    requestId: "uuid-1",
    requestDbId: "7",
    decision: "APPROVE",
    reason: "تم الجرد الفعلي",
    openingDate: "2026-11-04",
    countedRaw: "yes",
  });
  assert.equal(approvedChecked.counted, true);
  assert.equal(approvedChecked.requestId2, "7");

  const approvedUnchecked = buildCustodyDecisionPayload({
    requestId: "uuid-2",
    requestDbId: "7",
    decision: "APPROVE",
    reason: "نسيت المربع",
    openingDate: "2026-11-04",
    countedRaw: "",
  });
  assert.equal(approvedUnchecked.counted, false);

  const rejected = buildCustodyDecisionPayload({
    requestId: "uuid-3",
    requestDbId: "7",
    decision: "REJECT",
    reason: "لا حاجة لعهدة جديدة حاليًا",
    openingDate: "2026-11-04",
    countedRaw: "",
  });
  assert.equal(rejected.counted, undefined);
  assert.equal(rejected.openingDate, undefined);
  assert.equal(rejected.decision, "REJECT");
});

test("decideCustodyRequest works end-to-end on PGlite for both REJECT and APPROVE via buildCustodyDecisionPayload", { timeout: 60_000 }, async () => {
  const root = process.cwd();
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  const pg = new PGlite();
  try {
    await pg.exec(read("tests/fixtures/inventory-baseline.sql"));
    await pg.exec(read("tests/fixtures/finance-legacy-categories.sql"));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    await pg.exec(read("prototypes/finance-release/release-candidate.test-only.sql"));
    await pg.exec(read("prisma/manual-settlement-upgrade.sql"));
    await pg.exec(read("prisma/manual-custody-closure-upgrade.sql"));
    // تشغيل إنشاء جدول طلبات العهدة فقط دون استعلامات التحقق النهائية
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS finance.custody_requests (
        id BIGSERIAL PRIMARY KEY,
        branch_id BIGINT NOT NULL REFERENCES public.branches(id),
        requester_id BIGINT NOT NULL REFERENCES public.users(id),
        requested_amount NUMERIC(14,2) NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        decided_by BIGINT REFERENCES public.users(id),
        decided_at TIMESTAMPTZ,
        decision_reason TEXT,
        account_id BIGINT REFERENCES finance.accounts(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const db: FinanceDatabase = {
      serializable: (work) =>
        pg.transaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
          const port: FinanceTransaction = {
            query: async <T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) => ({
              rows: (await tx.query(sql, parameters)).rows as T[],
            }),
          };
          return work(port);
        }),
    };

    const snapshot = async (id: string) => custodyRequestSnapshot((await pg.query<{ id: string; branchId: string; requesterId: string; amount: string; reason: string }>(`SELECT id::text AS id, branch_id::text AS "branchId", requester_id::text AS "requesterId", requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`, [id])).rows[0]);

    // ١) الموظف (id=3) يقدّم طلب عهدة والمدير (id=1) يرفضه بدون الحاجة لتحديد الجرد الفعلي
    const initialRequest = { requestId: randomUUID(), amount: "1500.00", reason: "عهدة مصروفات نثرية" };
    await pg.exec("UPDATE public.branches SET is_active=false WHERE id=1");
    const beforeInactive = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.custody_requests) AS custody,
      (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audit`)).rows[0];
    await assert.rejects(() => requestCustody(db, "3", initialRequest), (err: unknown) => err instanceof FinanceProblem && err.code === "branch_unavailable");
    assert.deepEqual((await pg.query(`SELECT (SELECT count(*)::int FROM finance.custody_requests) AS custody,
      (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audit`)).rows[0], beforeInactive);
    await pg.exec("UPDATE public.branches SET is_active=true WHERE id=1");
    const req1 = await requestCustody(db, "3", initialRequest);
    await pg.query(`INSERT INTO finance.custody_requests (branch_id,requester_id,requested_amount,reason,status,decided_by,decided_at,decision_reason,created_at)
      SELECT 1,3,1,'تاريخ اختباري','REJECTED',1,now(),'رفض اختباري',now()+n*interval '1 second' FROM generate_series(1,12) n`);
    assert.equal((await getMyPendingCustodyRequest(db, "3")).pending?.id, req1.id, "pending check is independent of latest history limit");
    assert.equal((await getMyPendingCustodyRequest(db, "3")).pending?.branchId, "1");
    // The employee may still see and replay their own pending request after a
    // branch move; a new request remains blocked until that one is resolved.
    await pg.exec("UPDATE public.users SET branch_id=2 WHERE id=3");
    assert.equal((await getMyPendingCustodyRequest(db, "3")).pending?.branchId, "1");
    assert.deepEqual(await requestCustody(db, "3", initialRequest), {id:req1.id,replayed:true});
    await assert.rejects(() => requestCustody(db, "3", {...initialRequest,requestId:randomUUID()}), (err: unknown) => err instanceof FinanceProblem && err.code === "duplicate_request");
    // A corrupted result no longer owned by the requester cannot be replayed.
    await pg.query("UPDATE finance.custody_requests SET requester_id=1 WHERE id=$1::bigint",[req1.id]);
    await assert.rejects(() => requestCustody(db,"3",initialRequest), (err: unknown) => err instanceof FinanceProblem && err.code === "forbidden");
    let injected=false;
    const duplicate:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!injected && sql.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic unique"),{code:"23505"});}
      return tx.query<T>(sql,params);
    }}))};
    await assert.rejects(() => requestCustody(duplicate,"3",initialRequest), (err: unknown) => err instanceof FinanceProblem && err.code === "forbidden");
    assert.equal(injected,true);
    await pg.query("UPDATE finance.custody_requests SET requester_id=3 WHERE id=$1::bigint",[req1.id]);
    await pg.exec("UPDATE public.users SET branch_id=1 WHERE id=3");
    assert.deepEqual(await requestCustody(db,"3",initialRequest),{id:req1.id,replayed:true});
    await assert.rejects(() => getMyPendingCustodyRequest(db, "1"), (err: unknown) => err instanceof FinanceProblem && err.code === "forbidden");
    await pg.exec("UPDATE public.branches SET is_active=false WHERE id=1");
    assert.equal((await requestCustody(db, "3", initialRequest)).replayed, true, "saved request replay precedes new branch guard");
    await assert.rejects(() => decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: req1.id, decision: "APPROVE", reason: "محاولة اصطناعية", openingDate: "2026-11-04", counted: true }, "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "branch_unavailable");
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [req1.id])).rows[0].status, "PENDING");
    const rejRes = await decideCustodyRequest(
      db,
      "1",
      buildCustodyDecisionPayload({
        requestId: randomUUID(),
        requestDbId: req1.id,
        decision: "REJECT",
        reason: "تأجيل لحين الجرد",
        openingDate: "2026-11-04",
        countedRaw: "",
      }),
      "2026-11-04",
    );
    assert.equal(rejRes.id, req1.id);
    assert.deepEqual(await getMyPendingCustodyRequest(db, "3"), { available: true, pending: null });
    assert.equal((await listAccounts(db, "1")).length, 0);
    await pg.exec("UPDATE public.branches SET is_active=true WHERE id=1");
    // Simulate a legacy reject saved with the old helper's fabricated count
    // and date. The new helper may replay it without re-creating either fact.
    const legacyId = randomUUID();
    const legacyFields = { requestId: legacyId, requestDbId: req1.id, decision: "REJECT", reason: "رفض قديم اصطناعي", openingDate: "2026-11-04", countedRaw: "" };
    const legacyPayload = { requestId: legacyId, requestDbId: req1.id, decision: "REJECT", reason: legacyFields.reason, openingDate: legacyFields.openingDate, counted: true };
    const hash = createHash("sha256").update(JSON.stringify({ actorId: "1", action: "CUSTODY_DECIDE", payload: legacyPayload })).digest("hex");
    await pg.query(`INSERT INTO finance.requests(request_id,request_hash,actor_id,action,result_id) VALUES($1::uuid,$2,1,'CUSTODY_DECIDE',$3::bigint)`, [legacyId,hash,req1.id]);
    await pg.query(`INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id) VALUES($1::uuid,'CUSTODY_DECIDE',1,'finance.custody_requests',$2::bigint)`, [legacyId,req1.id]);
    assert.equal((await decideCustodyRequest(db,"1",buildCustodyDecisionPayload(legacyFields),"2026-11-04")).replayed,true);
    await assert.rejects(() => decideCustodyRequest(db,"1",buildCustodyDecisionPayload({ ...legacyFields, reason: "سبب مختلف" }),"2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "request_conflict");
    assert.equal((await listAccounts(db,"1")).length,0);

    // ٢) الموظف يقدّم طلبًا جديدًا؛ الموافقة تفشل إن لم يُقرّ المدير الجرد، وتنجح عند إقراره
    const req2 = await requestCustody(db, "3", {
      requestId: randomUUID(),
      amount: "2000.00",
      reason: "عهدة تشغيل الفرع",
    });
    await assert.rejects(
      () =>
        decideCustodyRequest(
          db,
          "1",
          buildCustodyDecisionPayload({
            requestId: randomUUID(),
            requestDbId: req2.id,
            decision: "APPROVE",
            reason: "اعتماد",
            openingDate: "2026-11-04",
            countedRaw: "",
          }),
          "2026-11-04",
        ),
      (err: unknown) => err instanceof FinanceProblem && err.code === "invalid_input",
    );

    const beforeFuture = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests, (SELECT count(*)::int FROM finance.audit_events) AS audits, (SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0];
    await assert.rejects(() => decideCustodyRequest(db, "1", buildCustodyDecisionPayload({
      requestId: randomUUID(), requestDbId: req2.id, decision: "APPROVE", reason: "جرد مستقبلي اصطناعي",
      openingDate: "2026-11-05", countedRaw: "yes",
    }), "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "future_date");
    assert.equal((await listAccounts(db, "1")).length, 0);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [req2.id])).rows[0].status, "PENDING");
    assert.deepEqual((await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests, (SELECT count(*)::int FROM finance.audit_events) AS audits, (SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0], beforeFuture);

    const reviewedSnapshot = await snapshot(req2.id);
    const staleApproval = { requestId: randomUUID(), requestId2: req2.id, decision: "APPROVE", reason: "جرد اصطناعي", openingDate: "2026-11-04", counted: true, expectedSnapshot: reviewedSnapshot };
    await pg.query("UPDATE finance.custody_requests SET requested_amount=2500, reason='تغير اصطناعي' WHERE id=$1::bigint", [req2.id]);
    const beforeStale = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests, (SELECT count(*)::int FROM finance.audit_events) AS audits, (SELECT count(*)::int FROM finance.accounts) AS accounts, (SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0];
    await assert.rejects(() => decideCustodyRequest(db, "1", staleApproval, "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "request_changed");
    assert.deepEqual((await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests, (SELECT count(*)::int FROM finance.audit_events) AS audits, (SELECT count(*)::int FROM finance.accounts) AS accounts, (SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0], beforeStale);
    await assert.rejects(() => decideCustodyRequest(db, "1", { ...staleApproval, expectedSnapshot: "" }, "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "invalid_input");
    await pg.query("UPDATE finance.custody_requests SET requested_amount=2000, reason='عهدة تشغيل الفرع' WHERE id=$1::bigint", [req2.id]);
    const approvedPayload = buildCustodyDecisionPayload({
      requestId: randomUUID(), requestDbId: req2.id, decision: "APPROVE", reason: "تم جرد النقد وتسليمه فعليًا",
      openingDate: "2026-11-04", countedRaw: "yes", expectedSnapshot: await snapshot(req2.id),
    });
    const appRes = await decideCustodyRequest(db, "1", approvedPayload, "2026-11-04");
    assert.equal((await decideCustodyRequest(db, "1", approvedPayload, "2026-11-04")).replayed, true);
    await assert.rejects(() => decideCustodyRequest(db, "1", { ...approvedPayload, expectedSnapshot: "0".repeat(64) }, "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "request_conflict");
    const allAccounts = await listAccounts(db, "1");
    assert.equal(allAccounts.length, 1);
    assert.equal(allAccounts[0].id, appRes.id);
    assert.equal(allAccounts[0].kind, "CUSTODY");
    assert.equal(allAccounts[0].holderId, "3");
    assert.equal(allAccounts[0].balance, "2000.00");
    // Old successful approvals had no expected snapshot. A new submission is
    // guarded, but matching old executions remain replayable with either form.
    const oldApprovalId = randomUUID();
    const oldApproval = { requestId: oldApprovalId, requestDbId: req2.id, decision: "APPROVE", reason: "اعتماد قديم اصطناعي", openingDate: "2026-11-04", counted: true };
    const oldInput = { requestId: oldApprovalId, requestDbId: req2.id, decision: "APPROVE", reason: oldApproval.reason, openingDate: oldApproval.openingDate, counted: true };
    const oldHash = createHash("sha256").update(JSON.stringify({ actorId: "1", action: "CUSTODY_DECIDE", payload: oldInput })).digest("hex");
    await pg.query(`INSERT INTO finance.requests(request_id,request_hash,actor_id,action,result_id) VALUES($1::uuid,$2,1,'CUSTODY_DECIDE',$3::bigint)`, [oldApprovalId, oldHash, appRes.id]);
    await pg.query(`INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id) VALUES($1::uuid,'CUSTODY_DECIDE',1,'finance.accounts',$2::bigint)`, [oldApprovalId,appRes.id]);
    assert.equal((await decideCustodyRequest(db, "1", { ...oldApproval, requestId2: req2.id }, "2026-11-04")).replayed, true);
    assert.equal((await decideCustodyRequest(db, "1", { ...oldApproval, requestId2: req2.id, expectedSnapshot: reviewedSnapshot }, "2026-11-04")).replayed, true);
    await assert.rejects(() => decideCustodyRequest(db, "1", { ...oldApproval, requestId2: req2.id, reason: "مختلف", expectedSnapshot: reviewedSnapshot }, "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "request_conflict");
    assert.equal((await listAccounts(db, "1")).length, 1);


    // The request keeps its originating branch even if its employee is moved later.
    await pg.exec(`UPDATE users SET branch_id=1 WHERE id=2;
      INSERT INTO users (branch_id,role_code,full_name,email,password_hash,status,must_change_password)
      VALUES (2,'ACCOUNTANT','محاسب فرع ثان','a2@example.test','fixture','ACTIVE',false),
             (2,'CS_AGENT','موظف فرع ثان','s2@example.test','fixture','ACTIVE',false),
             (NULL,'ACCOUNTANT','محاسب بلا فرع','a0@example.test','fixture','ACTIVE',false);`);
    const cross = await requestCustody(db, "6", { requestId: randomUUID(), amount: "100", reason: "طلب الفرع الثاني" });
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=6");
    assert.equal((await listCustodyRequests(db, "2")).some((r) => r.id === cross.id), false);
    assert.equal((await listCustodyRequests(db, "5")).some((r) => r.id === cross.id), true);
    assert.equal((await listCustodyRequests(db, "7")).length, 0);
    assert.equal((await listCustodyRequests(db, "1")).some((r) => r.id === cross.id), true);
    const payload = buildCustodyDecisionPayload({ requestId: randomUUID(), requestDbId: cross.id, decision: "REJECT", reason: "قرار اختباري", openingDate: "2026-11-04", countedRaw: "" });
    const forbidden = (err: unknown) => err instanceof FinanceProblem && err.code === "forbidden";
    await assert.rejects(() => decideCustodyRequest(db, "2", payload, "2026-11-04"), forbidden);
    await assert.rejects(() => decideCustodyRequest(db, "7", payload, "2026-11-04"), forbidden);
    const approvedAttempt = { ...payload, requestId: randomUUID(), decision: "APPROVE", counted: true, openingDate: "2026-11-04" };
    await assert.rejects(() => decideCustodyRequest(db, "2", approvedAttempt, "2026-11-04"), forbidden);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1", [cross.id])).rows[0].status, "PENDING");
    assert.equal((await listAccounts(db, "1")).length, 1, "unauthorized approval must not open an account");
    const result = await decideCustodyRequest(db, "5", payload, "2026-11-04");
    assert.equal(result.id, cross.id); assert.equal(result.replayed, false);
    assert.equal((await decideCustodyRequest(db, "5", payload, "2026-11-04")).replayed, true);
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=5");
    await assert.rejects(() => decideCustodyRequest(db, "5", payload, "2026-11-04"), forbidden);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1", [cross.id])).rows[0].status, "REJECTED");

    // A direct opening after a request leaves the request pending. The unique
    // index prevents approval from opening another account, without a decision.
    const overlapping = await requestCustody(db, "6", { requestId: randomUUID(), amount: "100", reason: "طلب قبل الفتح المباشر" });
    const openedInput = { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "6", openingAmount: "0", openingDate: "2026-11-04", counted: true };
    const direct = await openAccount(db, "1", openedInput, "2026-11-04");
    const decision = { requestId: randomUUID(), requestId2: overlapping.id, decision: "APPROVE", reason: "تعارض اصطناعي", openingDate: "2026-11-04", counted: true, expectedSnapshot: await snapshot(overlapping.id) };
    const counts = async () => (await pg.query(`SELECT (SELECT count(*)::int FROM finance.accounts) AS accounts,
      (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,
      (SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0];
    const beforeConflict = await counts();
    await assert.rejects(() => decideCustodyRequest(db, "1", decision, "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "duplicate" && /سواء كانت مفتوحة أو مقفلة/.test(err.message));
    assert.deepEqual(await counts(), beforeConflict);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [overlapping.id])).rows[0].status, "PENDING");
    await decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: overlapping.id, decision: "REJECT", reason: "فُتحت العهدة مباشرة" }, "2026-11-04");
    assert.equal((await openAccount(db, "1", openedInput, "2026-11-04")).replayed, true);
    // Deliberately synthetic closed state; this fixture has no commerce tables
    // and does not exercise or bypass the actual close workflow.
    await pg.query("UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE id=$1::bigint", [direct.id]);
    const afterClose = await requestCustody(db, "6", { requestId: randomUUID(), amount: "5", reason: "طلب بعد إقفال اختباري" });
    const beforeClosedConflict = await counts();
    const closedSnapshot = await snapshot(afterClose.id);
    await assert.rejects(() => decideCustodyRequest(db, "1", { ...decision, requestId: randomUUID(), requestId2: afterClose.id, expectedSnapshot: closedSnapshot }, "2026-11-04"), (err: unknown) => err instanceof FinanceProblem && err.code === "duplicate" && /سواء كانت مفتوحة أو مقفلة/.test(err.message));
    assert.deepEqual(await counts(), beforeClosedConflict);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [afterClose.id])).rows[0].status, "PENDING");
    await decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: afterClose.id, decision: "REJECT", reason: "مراجعة العهدة المقفلة" }, "2026-11-04");
  } finally {
    await pg.close();
  }
});

