import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { FinEmptyState } from "@/components/finance/fin-empty-state";
import { FinKpiStrip } from "@/components/finance/fin-kpi-strip";
import PantherSpotlightCard, {
  type PantherChartPoint,
  type PantherChartSeries,
} from "@/components/panther-spotlight-card";
import PrintPageButton from "@/components/print-page-button";
import { getSession } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts, listSettlements } from "@/lib/finance/engine";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { prisma } from "@/lib/prisma";
import { accountLabel, formatMoney } from "../format";
import { financeRead } from "../page-context";
import { SETTLEMENT_STATUS_LABEL } from "../settlements/settlement-forms";
import {
  SettlementDecisionCard,
  type SettlementDecisionItem,
} from "./settlement-decisions";
import TransferForm, { type AccountOption } from "./transfer-form";
import TransfersLedgerView, {
  type ArchivedSettlementRow,
  type TransferLedgerRow,
} from "./transfers-ledger-view";

export const dynamic = "force-dynamic";

function moneyToCents(raw: string | number | null | undefined): bigint {
  const s = String(raw ?? "0").trim();
  const neg = s.startsWith("-");
  const clean = s.replace(/^[+-]/, "");
  const [whole = "0", frac = ""] = clean.split(".");
  const w = /^\d+$/.test(whole) ? BigInt(whole) : 0n;
  const fStr = (frac + "00").slice(0, 2);
  const f = /^\d{2}$/.test(fStr) ? BigInt(fStr) : 0n;
  const cents = w * 100n + f;
  return neg ? -cents : cents;
}

function centsToMoneyStr(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

function displayCents(cents: bigint): string {
  return formatMoney(centsToMoneyStr(cents));
}

export default async function FinanceTransfersPage() {
  const session = await getSession();
  await requireMenuScopeAccess("/finance/transfers");
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");
  const canManage =
    session.role === "MANAGER" || session.role === "ACCOUNTANT";

  const [branches, users, accounts] = await Promise.all([
    prisma.branch.findMany({
      select: { id: true, nameAr: true },
      orderBy: { id: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, fullName: true },
    }),
    financeDb.serializable(async (tx) => {
      await assertFinanceActor(tx, {
        id: session.id,
        role: session.role,
        branchId: session.branchId,
      });
      return listAccounts({ serializable: (work) => work(tx) }, session.id);
    }),
  ]);

  const settlements = canManage
    ? await financeRead(session, (tx) =>
        listSettlements({ serializable: (work) => work(tx) }, session.id),
      )
    : [];

  const branchNames = new Map(
    branches.map((branch) => [branch.id.toString(), branch.nameAr]),
  );
  const userNames = new Map(
    users.map((user) => [user.id.toString(), user.fullName]),
  );
  const actorFullName = userNames.get(String(session.id)) ?? "مستخدم";

  // فصل الحسابات المفتوحة فقط للتسليم الجديد، مع إبقاء المرجع الكامل لعرض السجل التاريخي
  const openAccounts = accounts.filter((account) => !account.closedAt);

  const branchesWithVault = new Set(
    openAccounts
      .filter((account) => String(account.kind) === "VAULT")
      .map((account) => String(account.branchId)),
  );
  const balanceByAccount = new Map(
    accounts.map((account) => [account.id, account.balance]),
  );
  const holderByAccount = new Map(
    accounts.map((account) => [
      account.id,
      account.holderId ? userNames.get(account.holderId) ?? null : null,
    ]),
  );

  const ownCustody =
    openAccounts.find(
      (item) =>
        item.kind === "CUSTODY" &&
        String(item.holderId ?? "") === String(session.id),
    ) ?? null;

  if (!canManage && !ownCustody) {
    return (
      <div className="fin-page">
        <Link href="/finance/mine" className="fin-back no-print">
          <AppIcon name="arrow" />
          <span>العودة إلى عهدتي</span>
        </Link>
        <FinEmptyState icon="cash" title="لا توجد عهدة مفتوحة باسمك حاليًا">
          <p>
            تُفتح العهدة بجرد فعلي يعتمده المدير أو المحاسب، أو يمكنك تقديم طلب فتح عهدة من صفحة «عهدتي النقدية».
          </p>
          <div className="fin-actions" style={{ justifyContent: "center", marginTop: 14 }}>
            <Link className="fin-button" href="/finance/mine">
              فتح صفحة عهدتي النقدية
            </Link>
          </div>
        </FinEmptyState>
      </div>
    );
  }

  // لموظف الفرع: قراءة معرّف خزنة فرعه فقط (دون كشف رصيد الخزنة السري) لتمكين التوريد الآمن
  let staffVaultOption: AccountOption | null = null;
  if (!canManage && ownCustody && session.branchId) {
    const vaultLookup = await financeRead(session, (tx) =>
      tx.query<{ id: string; branchId: string }>(
        `SELECT id::text AS id, branch_id::text AS "branchId"
           FROM finance.accounts
          WHERE kind = 'VAULT'
            AND branch_id = $1::bigint
          ORDER BY id ASC
          LIMIT 1`,
        [session.branchId],
      ),
    ).catch(() => ({ rows: [] }));

    const vRow = vaultLookup.rows[0];
    if (vRow) {
      staffVaultOption = {
        id: vRow.id,
        kind: "VAULT",
        branchId: vRow.branchId,
        branchName: branchNames.get(vRow.branchId) ?? "الفرع",
        holderName: null,
        balance: null,
      };
    }
  }

  const options: AccountOption[] = canManage
    ? openAccounts.map((account) => ({
        id: account.id,
        kind: account.kind,
        branchId: account.branchId,
        branchName: branchNames.get(account.branchId) ?? "فرع",
        holderName: account.holderId
          ? userNames.get(account.holderId) ?? "موظف"
          : null,
        balance: account.balance,
      }))
    : [
        ...(ownCustody
          ? [
              {
                id: ownCustody.id,
                kind: "CUSTODY" as const,
                branchId: ownCustody.branchId,
                branchName: branchNames.get(ownCustody.branchId) ?? "فرع",
                holderName:
                  ownCustody.holderId
                    ? userNames.get(ownCustody.holderId) ?? actorFullName
                    : actorFullName,
                balance: ownCustody.balance,
              },
            ]
          : []),
        ...(staffVaultOption ? [staffVaultOption] : []),
      ];

  const pendingSettlements: SettlementDecisionItem[] = settlements
    .filter((settlement) => String(settlement.status) === "OPEN")
    .map((settlement) => ({
      id: String(settlement.id),
      branchId: String(settlement.branchId),
      branchName: branchNames.get(String(settlement.branchId)) ?? "فرع",
      holderName:
        holderByAccount.get(String(settlement.accountId)) ??
        userNames.get(String(settlement.requestedBy)) ??
        null,
      systemBalance: String(settlement.systemBalance),
      countedAmount: String(settlement.countedAmount),
      salesTotal: String(settlement.salesTotal),
      expensesTotal: String(settlement.expensesTotal),
      expectedAmount: String(settlement.expectedAmount),
      deviation: String(settlement.deviation),
      adjustment: String(settlement.adjustment),
      reason: String(settlement.reason),
      createdAt: String(settlement.createdAt),
      expectedBalance:
        balanceByAccount.get(String(settlement.accountId)) ??
        String(settlement.systemBalance),
    }));

  const transferDateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  });
  const cairoDayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayCairo = cairoDayFmt.format(new Date());
  const currentMonthPrefix = todayCairo.slice(0, 7);

  const archivedSettlements: ArchivedSettlementRow[] = canManage
    ? settlements
        .filter((s) => String(s.status) !== "OPEN")
        .map((s) => {
          const st = String(s.status) as
            | "CONFIRMED"
            | "REJECTED"
            | "CANCELLED";
          const resDate = s.resolvedAt ? new Date(String(s.resolvedAt)) : null;
          const holder =
            holderByAccount.get(String(s.accountId)) ??
            userNames.get(String(s.requestedBy)) ??
            "موظف";
          const resolver = s.resolvedBy
            ? userNames.get(String(s.resolvedBy)) ?? `مستخدم #${s.resolvedBy}`
            : "—";
          const trAmt = s.transferAmount ? Number(s.transferAmount) : 0;
          const trDir =
            s.transferDirection === "TO_VAULT"
              ? "إلى الخزنة"
              : s.transferDirection === "TO_CUSTODY"
                ? "إلى العهدة"
                : "";
          return {
            id: String(s.id),
            branchName: branchNames.get(String(s.branchId)) ?? "فرع",
            holderName: holder,
            createdAtDate: String(s.createdAt).slice(0, 10),
            resolvedAtFormatted:
              resDate && !Number.isNaN(resDate.getTime())
                ? transferDateFmt.format(resDate)
                : String(s.resolvedAt ?? s.createdAt).slice(0, 16),
            expectedAmountFormatted: `${formatMoney(String(s.expectedAmount))} ج.م`,
            countedAmountFormatted: `${formatMoney(String(s.countedAmount))} ج.م`,
            adjustmentFormatted: `${formatMoney(String(s.adjustment))} ج.م`,
            transferSummary:
              st === "CONFIRMED" && trAmt > 0
                ? `${formatMoney(String(s.transferAmount))} ج.م (${trDir})`
                : st === "CONFIRMED"
                  ? "مطابق (0.00)"
                  : "بلا أثر مالي",
            status: st,
            statusLabel: SETTLEMENT_STATUS_LABEL[st] ?? st,
            resolvedByName: resolver,
            reasonText: String(s.resolutionReason ?? s.reason ?? ""),
          };
        })
    : [];

  const staleSettlements =
    canManage && pendingSettlements.length
      ? await financeRead(session, (tx) =>
          tx.query<{ id: string }>(`
        SELECT s.id::text AS id FROM finance.settlements s
        JOIN finance.accounts a ON a.id = s.account_id
        WHERE s.status = 'OPEN' AND (
          EXISTS (SELECT 1 FROM finance.movements m
                   WHERE (m.source_id = a.id OR m.destination_id = a.id) AND m.created_at > s.created_at)
          OR EXISTS (SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales sl ON sl.id = c.sale_id
                     WHERE sl.branch_id = a.branch_id AND c.method = 'CASH' AND c.created_at > s.created_at)
          OR EXISTS (SELECT 1 FROM finance.payments p JOIN finance.expenses e ON e.id = p.expense_id
                     WHERE e.branch_id = a.branch_id AND p.source = 'HOLDER_CASH' AND p.recorded_at > s.created_at)
        )`),
        )
      : { rows: [] };
  const staleSettlementIds = new Set(
    staleSettlements.rows.map((row) => row.id),
  );

  // استعلام حركات التسليم مع نوع الحسابين والمنفِّذ ورقم التسوية دون كشف أي رصيد سري
  const recentTransfersRes = await financeRead(session, (tx) =>
    tx.query<{
      id: string;
      branchId: string;
      sourceId: string;
      sourceKind: "VAULT" | "CUSTODY" | null;
      sourceHolderId: string | null;
      destId: string;
      destKind: "VAULT" | "CUSTODY" | null;
      destHolderId: string | null;
      amount: string;
      settlementId: string | null;
      actorId: string | null;
      createdAt: string;
    }>(
      `SELECT m.id::text AS id,
              m.branch_id::text AS "branchId",
              m.source_id::text AS "sourceId",
              sa.kind::text AS "sourceKind",
              sa.holder_id::text AS "sourceHolderId",
              m.destination_id::text AS "destId",
              da.kind::text AS "destKind",
              da.holder_id::text AS "destHolderId",
              m.amount::text AS amount,
              m.settlement_id::text AS "settlementId",
              m.actor_id::text AS "actorId",
              m.created_at::text AS "createdAt"
         FROM finance.movements m
         LEFT JOIN finance.accounts sa ON sa.id = m.source_id
         LEFT JOIN finance.accounts da ON da.id = m.destination_id
        WHERE m.kind = 'TRANSFER'
          ${
            canManage
              ? ""
              : "AND m.branch_id = $1::bigint AND (m.source_id = $2::bigint OR m.destination_id = $2::bigint)"
          }
        ORDER BY m.id DESC
        LIMIT 100`,
      canManage ? [] : [session.branchId, ownCustody!.id],
    ),
  ).catch(() => ({ rows: [] }));

  function formatMovementParty(
    branchName: string,
    kindVal: "VAULT" | "CUSTODY" | null,
    holderId: string | null,
    fallbackId: string,
  ): string {
    if (!kindVal) return `حساب #${fallbackId}`;
    const holder = holderId ? userNames.get(holderId) ?? null : null;
    return `${branchName} · ${accountLabel(kindVal)}${
      holder ? ` (${holder})` : ""
    }`;
  }

  let monthToVaultCents = 0n;
  let monthToVaultCount = 0;
  let monthToCustodyCents = 0n;
  let monthToCustodyCount = 0;
  let todayTransfersCents = 0n;
  let todayTransfersCount = 0;
  const dailyMap = new Map<string, { toVault: bigint; total: bigint; count: number }>();
  const branchVolumeMap = new Map<string, { total: bigint; toVault: bigint; count: number }>();

  const ledgerRows: TransferLedgerRow[] = recentTransfersRes.rows.map((r) => {
    const bName = branchNames.get(r.branchId) ?? "فرع";
    const dt = new Date(r.createdAt);
    const validDt = !Number.isNaN(dt.getTime());
    const dateKey = validDt
      ? cairoDayFmt.format(dt)
      : String(r.createdAt).slice(0, 10);
    const direction: "TO_VAULT" | "TO_CUSTODY" =
      r.destKind === "VAULT" ? "TO_VAULT" : "TO_CUSTODY";
    const amtCents = moneyToCents(r.amount);

    if (dateKey === todayCairo) {
      todayTransfersCents += amtCents;
      todayTransfersCount += 1;
    }
    if (dateKey.startsWith(currentMonthPrefix)) {
      if (direction === "TO_VAULT") {
        monthToVaultCents += amtCents;
        monthToVaultCount += 1;
      } else {
        monthToCustodyCents += amtCents;
        monthToCustodyCount += 1;
      }
      const dEntry = dailyMap.get(dateKey) ?? {
        toVault: 0n,
        total: 0n,
        count: 0,
      };
      dEntry.total += amtCents;
      if (direction === "TO_VAULT") dEntry.toVault += amtCents;
      dEntry.count += 1;
      dailyMap.set(dateKey, dEntry);

      const bEntry = branchVolumeMap.get(bName) ?? {
        total: 0n,
        toVault: 0n,
        count: 0,
      };
      bEntry.total += amtCents;
      if (direction === "TO_VAULT") bEntry.toVault += amtCents;
      bEntry.count += 1;
      branchVolumeMap.set(bName, bEntry);
    }

    return {
      id: r.id,
      branchName: bName,
      fromLabel: formatMovementParty(
        bName,
        r.sourceKind,
        r.sourceHolderId,
        r.sourceId,
      ),
      toLabel: formatMovementParty(bName, r.destKind, r.destHolderId, r.destId),
      direction,
      amount: r.amount,
      amountFormatted: formatMoney(r.amount),
      settlementId: r.settlementId,
      actorName: r.actorId
        ? userNames.get(r.actorId) ?? `مستخدم #${r.actorId}`
        : "النظام",
      timestampFormatted: validDt ? transferDateFmt.format(dt) : r.createdAt,
      dateKey,
    };
  });

  // بناء السلاسل التفاعلية لبطاقة المؤشر التنفيذي
  const sortedDays = Array.from(dailyMap.keys()).sort();
  const dailyPoints: PantherChartPoint[] = [
    {
      label: "بداية الشهر",
      shortLabel: "٠",
      value: 0,
      formattedValue: "0.00 ج.م",
    },
  ];
  if (sortedDays.length === 0) {
    dailyPoints.push({
      label: "الآن — لا تسليمات بالشهر بعد",
      shortLabel: "الآن",
      value: 0,
      formattedValue: "0.00 ج.م",
      detail: "تظهر المنحنيات فور تسجيل أول عملية تسليم نقدي",
    });
  } else {
    let cumTotal = 0n;
    for (const dKey of sortedDays) {
      const info = dailyMap.get(dKey)!;
      cumTotal += info.total;
      dailyPoints.push({
        label: `يوم ${dKey}`,
        shortLabel: dKey.slice(5),
        value: Number(cumTotal) / 100,
        formattedValue: `${displayCents(cumTotal)} ج.م`,
        detail: `حركات اليوم: ${displayCents(info.total)} ج.م (${info.count} سند)`,
      });
    }
  }

  const spotlightSeries: PantherChartSeries[] = canManage
    ? [
        {
          id: "liquidity-mix",
          label: "اتجاه التدفق",
          chartVariant: "donut",
          points: [
            {
              label: "توريد من العُهَد إلى الخزائن",
              shortLabel: "للخزائن",
              value: Number(monthToVaultCents) / 100,
              formattedValue: `${displayCents(monthToVaultCents)} ج.م`,
              detail: `${monthToVaultCount} عملية توريد للخزائن هذا الشهر`,
              tone: "accent",
            },
            {
              label: "تغذية من الخزائن إلى العُهَد",
              shortLabel: "للعُهَد",
              value: Number(monthToCustodyCents) / 100,
              formattedValue: `${displayCents(monthToCustodyCents)} ج.م`,
              detail: `${monthToCustodyCount} عملية تغذية عُهَد هذا الشهر`,
              tone: "alt",
            },
          ],
        },
        {
          id: "daily-sales",
          label: "المسار اليومي",
          chartVariant: "area",
          points: dailyPoints,
        },
        ...(branches.length > 0
          ? [
              {
                id: "by-branch",
                label: "حسب الفرع",
                chartVariant: "columns" as const,
                points: branches.map((b) => {
                  const stat = branchVolumeMap.get(b.nameAr) ?? {
                    total: 0n,
                    toVault: 0n,
                    count: 0,
                  };
                  return {
                    label: b.nameAr,
                    shortLabel: b.nameAr.replace(/^فرع\s+/, "").slice(0, 10),
                    value: Number(stat.total) / 100,
                    formattedValue: `${displayCents(stat.total)} ج.م`,
                    secondaryValue: Number(stat.toVault) / 100,
                    secondaryLabel: "وارد الخزنة",
                    secondaryFormatted: `${displayCents(stat.toVault)} ج.م`,
                    detail: `${stat.count} سند تسليم هذا الشهر`,
                  };
                }),
              },
            ]
          : []),
      ]
    : [
        {
          id: "daily-sales",
          label: "مسار توريداتك",
          chartVariant: "area",
          points: dailyPoints,
        },
        {
          id: "today-vs-period",
          label: "ملخص العهدة والتوريد",
          chartVariant: "columns",
          points: [
            {
              label: "رصيد عهدتك الدفتري الحالي",
              shortLabel: "رصيدك",
              value: Number(ownCustody?.balance ?? 0),
              formattedValue: `${formatMoney(ownCustody?.balance ?? "0")} ج.م`,
              detail: "الرصيد الدفتري المسجّل لعهدتك الآن",
            },
            {
              label: "ما سلّمته اليوم للخزنة",
              shortLabel: "توريد اليوم",
              value: Number(todayTransfersCents) / 100,
              formattedValue: `${displayCents(todayTransfersCents)} ج.م`,
              detail: `${todayTransfersCount} عملية تسليم اليوم`,
            },
            {
              label: "إجمالي توريدك بالشهر",
              shortLabel: "توريد الشهر",
              value: Number(monthToVaultCents) / 100,
              formattedValue: `${displayCents(monthToVaultCents)} ج.م`,
              detail: `${monthToVaultCount} عملية توريد هذا الشهر`,
            },
          ],
        },
      ];

  const distinctBranchesInLedger = Array.from(
    new Set(branches.map((b) => b.nameAr)),
  );

  return (
    <div className="fin-page">
      <Link
        href={canManage ? "/finance" : "/finance/mine"}
        className="fin-back no-print"
      >
        <AppIcon name="arrow" />
        <span>{canManage ? "العودة إلى المالية" : "العودة إلى عهدتي"}</span>
      </Link>

      <div className="fin-heading no-print">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            {canManage ? "مركز التسليم والتسويات النقدية" : "توريد النقد إلى الخزنة"}
          </p>
          <h1>تسليم وتحويل النقد</h1>
          <p>
            {canManage
              ? "إدارة التسليم الفعلي بين خزائن الفروع وعُهَد الموظفين، والبتّ الفوري في طلبات التسوية مع سجل رقابي وسندات طباعة رسمية."
              : "توريد النقد الفعلي من عهدتك إلى خزنة فرعك بخطوة موثّقة وسند استلام وتسليم رسمي قابل للطباعة."}
          </p>
        </div>
        <div className="fin-actions">
          {canManage && pendingSettlements.length > 0 ? (
            <a className="fin-button" href="#pending-settlements">
              <span>مراجعة التسويات المعلقة ({pendingSettlements.length})</span>
            </a>
          ) : null}
          <PrintPageButton
            label="طباعة سجل التسليم"
            className="fin-button fin-button--secondary"
            title="طباعة سجل حركات التسليم النقدي"
          />
        </div>
      </div>

      <div className="no-print">
        <PantherSpotlightCard
          icon={canManage ? "balanceScale" : "cashConversion"}
          chartVariant={canManage ? "donut" : "area"}
          title="حركة التسليم والتوريد النقدي"
          subtitle={`محدّث الآن · شهر ${currentMonthPrefix}`}
          pill={`${monthToVaultCount + monthToCustodyCount} حركة بالشهر`}
          primary={
            canManage
              ? {
                  label: "إجمالي التوريد للخزائن بالشهر",
                  value: displayCents(monthToVaultCents),
                  unit: "ج.م",
                  delta: `تغذية العُهَد بالشهر: ${displayCents(monthToCustodyCents)} ج.م (${monthToCustodyCount} حركة)`,
                  tone: "positive",
                }
              : {
                  label: "إجمالي توريدك لخزنة الفرع بالشهر",
                  value: displayCents(monthToVaultCents),
                  unit: "ج.م",
                  delta: `رصيد عهدتك الدفتري الحالي: ${formatMoney(ownCustody?.balance ?? "0")} ج.م`,
                  tone: "positive",
                }
          }
          secondary={
            canManage
              ? {
                  label: "طلبات تسوية بانتظار القرار",
                  value: String(pendingSettlements.length),
                  unit: "طلب",
                  delta:
                    pendingSettlements.length > 0
                      ? `${staleSettlementIds.size > 0 ? `${staleSettlementIds.size} طلب متقادم يحتاج إعادة جرد · ` : ""}افصل فيها من القسم أدناه`
                      : `0 معلقات · ${archivedSettlements.length} تسوية مؤرشفة في السجل`,
                  tone: pendingSettlements.length > 0 ? "negative" : "positive",
                }
              : {
                  label: "عمليات التوريد المسجّلة اليوم",
                  value: displayCents(todayTransfersCents),
                  unit: "ج.م",
                  delta:
                    todayTransfersCount > 0
                      ? `${todayTransfersCount} سند تسليم مسجّل اليوم`
                      : "لم تُسجَّل حركة تسليم اليوم بعد",
                  tone: "positive",
                }
          }
          series={spotlightSeries}
          actionHref={
            canManage && pendingSettlements.length > 0
              ? "#pending-settlements"
              : "#transfers-directory"
          }
          actionLabel={
            canManage && pendingSettlements.length > 0
              ? "الانتقال إلى طلبات التسوية المعلقة"
              : "استعراض السجل الرقابي وسندات الطباعة"
          }
        />
      </div>

      <FinKpiStrip
        label="ملخص التسليم والتسويات"
        className="no-print"
        items={[
          {
            icon: "transfers",
            label: canManage ? "وارد الخزائن (الشهر)" : "توريدك للخزنة (الشهر)",
            value: (
              <>
                <bdi dir="ltr">{displayCents(monthToVaultCents)}</bdi> <small>ج.م</small>
              </>
            ),
            sub: `عبر {monthToVaultCount} سند توريد نقدي`,
            tone: "accent",
          },
          {
            icon: "cash",
            label: canManage ? "تغذية العُهَد (الشهر)" : "رصيد عهدتك الدفتري",
            value: (
              <>
                <bdi dir="ltr">
                  {canManage ? displayCents(monthToCustodyCents) : formatMoney(ownCustody?.balance ?? "0")}
                </bdi>{" "}
                <small>ج.م</small>
              </>
            ),
            sub: canManage
              ? `${monthToCustodyCount} حركة تغذية من الخزائن`
              : `فرع ${branchNames.get(ownCustody?.branchId ?? "") ?? "الفرع"}`,
          },
          {
            icon: "receipt",
            label: "حركات التسليم اليوم",
            value: (
              <>
                <bdi dir="ltr">{displayCents(todayTransfersCents)}</bdi> <small>ج.م</small>
              </>
            ),
            sub: `${todayTransfersCount} حركة مسجّلة بتوقيت القاهرة`,
          },
          {
            icon: "shield",
            label: canManage ? "تسويات بانتظار القرار" : "إجمالي سنداتك بالسجل",
            value: String(canManage ? pendingSettlements.length : ledgerRows.length),
            sub: canManage
              ? pendingSettlements.length > 0
                ? "تتطلّب اعتمادًا أو رفضًا بسبب"
                : `${archivedSettlements.length} تسوية سابقة بالأرشيف`
              : "سندات موثّقة وجاهزة للطباعة",
            tone: canManage && pendingSettlements.length > 0 ? "alert" : "default",
          },
        ]}
      />

      {/* أولوية ١ للإدارة: طلبات التسوية المعلقة في الصدارة فور وجودها */}
      {canManage && pendingSettlements.length > 0 ? (
        <section
          id="pending-settlements"
          className="fin-page__section no-print"
          aria-label="طلبات التسوية المعلقة"
        >
          <div className="fin-heading">
            <div>
              <p className="fin-heading__eyebrow">
                <span className="fin-eyebrow-dot" aria-hidden="true" />
                قرار عاجل — عُهَد الموظفين
              </p>
              <h2>طلبات التسوية المعلقة ({pendingSettlements.length})</h2>
              <p>
                طلبات التسوية التي وصلت من موظفي الفروع (شاشة «عهدتي ← طلبات التسوية» لدى كل موظف) — قراركم هنا: اعتماد
                (حركتان في معاملة ذرّية واحدة: مطابقة الدفتر مع الواقع المعدود، ثم تحويل الفرق مع الخزنة) أو رفض ببيان.
              </p>
            </div>
            <div className="fin-actions">
              <span className="fin-badge fin-badge--pending">
                {pendingSettlements.length} بانتظار القرار
              </span>
            </div>
          </div>

          {pendingSettlements.map((item) => (
            <div key={item.id} className="fin-page__section">
              {staleSettlementIds.has(item.id) ? (
                <div className="fin-alert fin-alert--warning" role="status">
                  وقعت حركة نقدية على هذه العهدة بعد تقديم الطلب، فالمعدود لم يعد مطابقًا للنقد في اليد.
                  الاعتماد سيُرفض حتى يُلغى الطلب بسبب واضح ويُعاد الجرد بطلب جديد.
                </div>
              ) : null}
              {!branchesWithVault.has(item.branchId) ? (
                <div className="fin-alert fin-alert--warning" role="status">
                  لا توجد خزنة مفتوحة لفرع {item.branchName}. الاعتماد يحتاج خزنة تُحوَّل إليها أو منها، فسيُرفض بدونها.
                  افتح الخزنة بجرد فعلي من «الحسابات النقدية» أولًا.
                </div>
              ) : null}
              <SettlementDecisionCard item={item} />
            </div>
          ))}
        </section>
      ) : null}

      {/* نموذج التسليم الفعلي الذكي */}
      <div className="fin-page__section">
        {options.length < 2 ? (
          <FinEmptyState
            icon="transfers"
            className="no-print"
            title={
              canManage
                ? "يلزم وجود خزنة مفتوحة وعهدة موظف مفتوحة في الفرع نفسه"
                : "لا توجد خزنة مفتوحة لفرعك بعد لتوريد النقد إليها"
            }
          >
            <p>
              {canManage
                ? "افتح خزنة الفرع أو عهدة موظف بجرد فعلي من «الحسابات النقدية» لتفعيل التسليم الفوري."
                : "تواصل مع المدير أو المحاسب لفتح خزنة الفرع بجرد فعلي، أو قدّم طلب تسوية من صفحة التسويات."}
            </p>
            <div
              className="fin-actions"
              style={{ justifyContent: "center", marginTop: 14 }}
            >
              {canManage ? (
                <>
                  <Link className="fin-button" href="/finance/accounts">
                    فتح حساب بجرد فعلي
                  </Link>
                  <Link className="fin-button fin-button--secondary" href="/finance">
                    العودة إلى المالية
                  </Link>
                </>
              ) : null}
            </div>
          </FinEmptyState>
        ) : (
          <TransferForm
            requestId={randomUUID()}
            accounts={options}
            canManage={canManage}
            actorName={actorFullName}
          />
        )}
      </div>

      {/* السجل الرقابي الشامل + أرشيف قرارات التسوية + سندات الطباعة الرسمية */}
      <div className="fin-page__section">
        <TransfersLedgerView
          transfers={ledgerRows}
          archivedSettlements={archivedSettlements}
          branches={distinctBranchesInLedger}
          canManage={canManage}
        />
      </div>
    </div>
  );
}
