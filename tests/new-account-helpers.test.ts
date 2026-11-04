import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  decideCustodyRequest,
  listAccounts,
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
  assert.equal(rejected.counted, true);
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

    // ١) الموظف (id=3) يقدّم طلب عهدة والمدير (id=1) يرفضه بدون الحاجة لتحديد الجرد الفعلي
    const req1 = await requestCustody(db, "3", {
      requestId: randomUUID(),
      amount: "1500.00",
      reason: "عهدة مصروفات نثرية",
    });
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
    assert.equal((await listAccounts(db, "1")).length, 0);

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

    const appRes = await decideCustodyRequest(
      db,
      "1",
      buildCustodyDecisionPayload({
        requestId: randomUUID(),
        requestDbId: req2.id,
        decision: "APPROVE",
        reason: "تم جرد النقد وتسليمه فعليًا",
        openingDate: "2026-11-04",
        countedRaw: "yes",
      }),
      "2026-11-04",
    );
    const allAccounts = await listAccounts(db, "1");
    assert.equal(allAccounts.length, 1);
    assert.equal(allAccounts[0].id, appRes.id);
    assert.equal(allAccounts[0].kind, "CUSTODY");
    assert.equal(allAccounts[0].holderId, "3");
    assert.equal(allAccounts[0].balance, "2000.00");
  } finally {
    await pg.close();
  }
});

