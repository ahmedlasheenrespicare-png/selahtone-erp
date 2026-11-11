import { writeAllowedForKeys } from "@/lib/access-control";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { FinKpiStrip } from "@/components/finance/fin-kpi-strip";
import PantherSpotlightCard, {
  type PantherChartPoint,
  type PantherChartSeries,
} from "@/components/panther-spotlight-card";
import PrintPageButton from "@/components/print-page-button";
import { displayMoney } from "@/lib/commerce-display";
import { listAppCategories } from "@/lib/finance/app-categories";
import { listExpenses } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { prisma } from "@/lib/prisma";
import { financePage, financeRead } from "../page-context";
import CategoriesDirectoryView, {
  type CategoryAuditItem,
  type CategoryDirectoryItem,
} from "./categories-directory-view";
import { CreateCategoryForm } from "./category-forms";

export const dynamic = "force-dynamic";

function moneyToCents(raw: string): bigint {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace(/^-/, "").split(".");
  const cents =
    BigInt(whole || "0") * 100n +
    BigInt((fraction + "00").slice(0, 2) || "0");
  return negative ? -cents : cents;
}

function getPreviousMonthPrefix(currentYm: string): string {
  const [yStr, mStr] = currentYm.split("-");
  let year = Number(yStr);
  let month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return currentYm;
  month -= 1;
  if (month <= 0) {
    month = 12;
    year -= 1;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function shortenCategoryCode(code: string): string {
  const c = code.trim();
  if (c.length <= 14) return c;
  return `${c.slice(0, 6)}…${c.slice(-4)}`;
}

function parseJsonRecord(val: unknown): Record<string, unknown> | null {
  if (!val) return null;
  if (typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

type CatAccumulator = {
  monthPaidCents: bigint;
  monthPendingCents: bigint;
  prevMonthPaidCents: bigint;
  allTimePaidCents: bigint;
  allTimeTotalCents: bigint;
  totalCount: number;
  paidCount: number;
  pendingCount: number;
  lastExpenseDate: string | null;
};

function emptyAccumulator(): CatAccumulator {
  return {
    monthPaidCents: 0n,
    monthPendingCents: 0n,
    prevMonthPaidCents: 0n,
    allTimePaidCents: 0n,
    allTimeTotalCents: 0n,
    totalCount: 0,
    paidCount: 0,
    pendingCount: 0,
    lastExpenseDate: null,
  };
}

/** Management of the EXISTING expense categories: add, edit, deactivate, spend analytics & immutable audit trail. */
export default async function CategoriesPage() {
  const { session, canManage } = await financePage();
  await requirePageAccess("/finance/categories");
  const access = await getAccessContext();
  const canCreateCategory = writeAllowedForKeys(access.hidden, "/finance/categories#create");
  const canEditCategory = writeAllowedForKeys(access.hidden, "/finance/categories#edit");
  const canCreateExpense = writeAllowedForKeys(access.hidden, "/finance/expenses/new");
  const canOpenExpenses = access.isAllowed("/finance/expenses");
  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">
          العودة إلى المالية
        </Link>
        <div className="fin-alert fin-alert--error">
          إدارة بنود المصروفات متاحة للمدير والمحاسب فقط.
        </div>
      </div>
    );
  }

  const [categories, expenses, users, auditRes] = await Promise.all([
    financeRead(session, (tx) =>
      listAppCategories({ serializable: (work) => work(tx) }, session.id),
    ),
    financeRead(session, (tx) =>
      listExpenses({ serializable: (work) => work(tx) }, session.id),
    ).catch(() => []),
    prisma.user.findMany({
      select: { id: true, fullName: true },
    }),
    financeRead(session, (tx) =>
      tx.query<{
        id: string;
        categoryId: string;
        currentName: string;
        code: string;
        actorId: string;
        action: string;
        reason: string | null;
        beforeData: unknown;
        afterData: unknown;
        createdAt: string;
      }>(
        `SELECT a.id::text AS id,
                a.category_id::text AS "categoryId",
                c.name_ar AS "currentName",
                c.code AS code,
                a.actor_id::text AS "actorId",
                a.action AS action,
                a.reason AS reason,
                a.before_data AS "beforeData",
                a.after_data AS "afterData",
                a.created_at::text AS "createdAt"
           FROM finance.category_audit a
           JOIN public.expense_categories c ON c.id = a.category_id
          ORDER BY a.id DESC
          LIMIT 200`,
      ),
    ).catch(() => ({ rows: [] })),
  ]);

  const userNames = new Map(
    users.map((u) => [u.id.toString(), u.fullName]),
  );

  const currentMonthPrefix = cairoDate().slice(0, 7);
  const prevMonthPrefix = getPreviousMonthPrefix(currentMonthPrefix);

  const catIdByName = new Map(
    categories.map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const statsByCatId = new Map<string, CatAccumulator>();

  let grandMonthPaidCents = 0n;
  let grandMonthPendingCents = 0n;
  let grandPrevMonthPaidCents = 0n;
  let grandAllTimePaidCents = 0n;

  for (const exp of expenses) {
    const cents = moneyToCents(String(exp.amount));
    const dateStr = String(exp.expenseDate ?? "").slice(0, 10);
    const isCurrentMonth = dateStr.startsWith(currentMonthPrefix);
    const isPrevMonth = dateStr.startsWith(prevMonthPrefix);
    const isPaid = exp.status === "PAID";

    if (isPaid) {
      grandAllTimePaidCents += cents;
      if (isCurrentMonth) grandMonthPaidCents += cents;
      if (isPrevMonth) grandPrevMonthPaidCents += cents;
    } else if (isCurrentMonth) {
      grandMonthPendingCents += cents;
    }

    const resolvedCatId =
      (exp.categoryId ? String(exp.categoryId) : "") ||
      catIdByName.get(String(exp.categorySnapshot ?? "").trim().toLowerCase()) ||
      "";

    if (resolvedCatId) {
      const acc = statsByCatId.get(resolvedCatId) ?? emptyAccumulator();
      acc.allTimeTotalCents += cents;
      acc.totalCount += 1;
      if (isPaid) {
        acc.allTimePaidCents += cents;
        acc.paidCount += 1;
        if (isCurrentMonth) acc.monthPaidCents += cents;
        if (isPrevMonth) acc.prevMonthPaidCents += cents;
      } else {
        acc.pendingCount += 1;
        if (isCurrentMonth) acc.monthPendingCents += cents;
      }
      if (
        dateStr &&
        (!acc.lastExpenseDate || dateStr > acc.lastExpenseDate)
      ) {
        acc.lastExpenseDate = dateStr;
      }
      statsByCatId.set(resolvedCatId, acc);
    }
  }

  const directoryItems: CategoryDirectoryItem[] = categories.map((cat) => {
    const acc = statsByCatId.get(cat.id) ?? emptyAccumulator();
    const sharePct =
      grandMonthPaidCents > 0n
        ? Math.round(
            (Number(acc.monthPaidCents) / Number(grandMonthPaidCents)) * 100,
          )
        : 0;

    let momDeltaLabel = "لا حركة بالشهرين";
    let momTone: "up" | "down" | "flat" = "flat";

    if (acc.prevMonthPaidCents === 0n && acc.monthPaidCents > 0n) {
      momDeltaLabel = "صرف جديد هذا الشهر";
      momTone = "up";
    } else if (acc.prevMonthPaidCents > 0n && acc.monthPaidCents === 0n) {
      momDeltaLabel = "-100% (بلا صرف بعد)";
      momTone = "down";
    } else if (acc.prevMonthPaidCents > 0n && acc.monthPaidCents > 0n) {
      const pct = Math.round(
        ((Number(acc.monthPaidCents) - Number(acc.prevMonthPaidCents)) /
          Number(acc.prevMonthPaidCents)) *
          100,
      );
      if (pct > 0) {
        momDeltaLabel = `+${pct}% عن الشهر السابق`;
        momTone = "up";
      } else if (pct < 0) {
        momDeltaLabel = `${pct}% عن الشهر السابق`;
        momTone = "down";
      } else {
        momDeltaLabel = "مطابق للشهر السابق (0%)";
        momTone = "flat";
      }
    }

    return {
      id: cat.id,
      code: cat.code,
      shortCode: shortenCategoryCode(cat.code),
      name: cat.name,
      active: cat.active,
      revision: cat.revision,
      snapshot: cat.snapshot,
      monthPaidNum: Number(acc.monthPaidCents) / 100,
      monthPaidFormatted: displayMoney(acc.monthPaidCents),
      monthPendingNum: Number(acc.monthPendingCents) / 100,
      monthPendingFormatted: displayMoney(acc.monthPendingCents),
      prevMonthPaidNum: Number(acc.prevMonthPaidCents) / 100,
      prevMonthPaidFormatted: displayMoney(acc.prevMonthPaidCents),
      momDeltaLabel,
      momTone,
      sharePct,
      allTimePaidNum: Number(acc.allTimePaidCents) / 100,
      allTimePaidFormatted: displayMoney(acc.allTimePaidCents),
      allTimeTotalFormatted: displayMoney(acc.allTimeTotalCents),
      totalCount: acc.totalCount,
      paidCount: acc.paidCount,
      pendingCount: acc.pendingCount,
      lastExpenseDate: acc.lastExpenseDate,
      createdByName: cat.createdBy ? userNames.get(cat.createdBy) ?? null : null,
      updatedByName: cat.updatedBy ? userNames.get(cat.updatedBy) ?? null : null,
    };
  });

  const auditDateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  });

  const auditRows: CategoryAuditItem[] = auditRes.rows.map((r) => {
    const before = parseJsonRecord(r.beforeData);
    const after = parseJsonRecord(r.afterData);
    const beforeName = typeof before?.name === "string" ? before.name : null;
    const afterName =
      typeof after?.name === "string" ? after.name : r.currentName;
    const beforeActive =
      typeof before?.active === "boolean" ? before.active : null;
    const afterActive =
      typeof after?.active === "boolean" ? after.active : null;

    let actionKind: CategoryAuditItem["actionKind"] = "CREATE";
    let actionLabel = "إضافة بند جديد";
    const diffs: string[] = [];

    if (r.action === "CREATE") {
      actionKind = "CREATE";
      actionLabel = "إضافة بند جديد";
      diffs.push(`إنشاء البند «${afterName}» (نشط · إصدار #1)`);
    } else {
      const renamed = beforeName !== null && beforeName !== afterName;
      const toggled =
        beforeActive !== null &&
        afterActive !== null &&
        beforeActive !== afterActive;

      if (toggled && afterActive === false) {
        actionKind = "DEACTIVATE";
        actionLabel = "إيقاف بند";
      } else if (toggled && afterActive === true) {
        actionKind = "REACTIVATE";
        actionLabel = "إعادة تفعيل";
      } else {
        actionKind = "RENAME";
        actionLabel = "تعديل مسمى";
      }

      if (renamed) {
        diffs.push(`الاسم: «${beforeName}» ← «${afterName}»`);
      }
      if (toggled) {
        diffs.push(
          `الحالة: ${beforeActive ? "نشط" : "موقوف"} ← ${
            afterActive ? "نشط" : "موقوف"
          }`,
        );
      }
      if (diffs.length === 0) {
        diffs.push(`تحديث البند «${afterName}»`);
      }
    }

    const dt = new Date(r.createdAt);
    const validDt = !Number.isNaN(dt.getTime());

    return {
      id: r.id,
      categoryId: r.categoryId,
      categoryName: r.currentName,
      shortCode: shortenCategoryCode(r.code),
      actionKind,
      actionLabel,
      diffSummary: diffs.join(" · "),
      reasonText:
        r.reason && r.reason.trim().length > 0
          ? r.reason
          : r.action === "CREATE"
            ? "إدراج تأسيسي في دليل البنود"
            : "—",
      actorName: userNames.get(r.actorId) ?? `مستخدم #${r.actorId}`,
      timestampFormatted: validDt ? auditDateFmt.format(dt) : r.createdAt,
      dateKey: String(r.createdAt).slice(0, 10),
    };
  });

  const activeCount = directoryItems.filter((c) => c.active).length;
  const inactiveCount = directoryItems.length - activeCount;
  const unusedCount = directoryItems.filter((c) => c.totalCount === 0).length;

  const rankedBySpend = [...directoryItems].sort(
    (a, b) =>
      b.monthPaidNum - a.monthPaidNum ||
      b.allTimePaidNum - a.allTimePaidNum ||
      a.name.localeCompare(b.name, "ar"),
  );
  const topCat = rankedBySpend[0] ?? null;

  const useAllTimeFallback =
    grandMonthPaidCents === 0n && grandAllTimePaidCents > 0n;

  const topPoints: PantherChartPoint[] = rankedBySpend.slice(0, 6).map((c) => {
    const val = useAllTimeFallback ? c.allTimePaidNum : c.monthPaidNum;
    const fmt = useAllTimeFallback
      ? c.allTimePaidFormatted
      : c.monthPaidFormatted;
    return {
      label: c.name,
      shortLabel: c.name.slice(0, 12),
      value: val,
      formattedValue: `${fmt} ج.م`,
      detail: useAllTimeFallback
        ? `إجمالي تاريخي (${c.paidCount} عملية مدفوعة)`
        : `${c.sharePct}% من مدفوعات الشهر · ${c.momDeltaLabel}`,
    };
  });

  const donutPoints: PantherChartPoint[] = rankedBySpend
    .filter((c) => (useAllTimeFallback ? c.allTimePaidNum > 0 : c.monthPaidNum > 0))
    .slice(0, 5)
    .map((c, idx) => ({
      label: c.name,
      shortLabel: c.name.slice(0, 10),
      value: useAllTimeFallback ? c.allTimePaidNum : c.monthPaidNum,
      formattedValue: `${
        useAllTimeFallback ? c.allTimePaidFormatted : c.monthPaidFormatted
      } ج.م`,
      detail: `${c.totalCount} عملية مسجّلة`,
      tone: idx === 0 ? "accent" : idx === 1 ? "alt" : undefined,
    }));

  if (donutPoints.length === 0) {
    donutPoints.push({
      label: "لا توجد مصروفات مدفوعة بعد",
      shortLabel: "بلا صرف",
      value: 0,
      formattedValue: "0.00 ج.م",
      detail: "يظهر التوزيع فور صرف أول مصروف معتمد",
    });
  }

  const momPoints: PantherChartPoint[] = rankedBySpend.slice(0, 6).map((c) => ({
    label: c.name,
    shortLabel: c.name.slice(0, 10),
    value: c.monthPaidNum,
    formattedValue: `${c.monthPaidFormatted} ج.م`,
    secondaryValue: c.prevMonthPaidNum,
    secondaryLabel: `الشهر السابق (${prevMonthPrefix})`,
    secondaryFormatted: `${c.prevMonthPaidFormatted} ج.م`,
    detail: c.momDeltaLabel,
  }));

  const spotlightSeries: PantherChartSeries[] = [
    {
      id: "top-categories",
      label: useAllTimeFallback ? "الأعلى تاريخيًا" : "الأعلى بالشهر",
      chartVariant: "bars",
      points:
        topPoints.length > 0
          ? topPoints
          : [
              {
                label: "لم تُضف بنود بعد",
                shortLabel: "—",
                value: 0,
                formattedValue: "0.00 ج.م",
              },
            ],
    },
    {
      id: "category-share",
      label: "حصص البنود",
      chartVariant: "donut",
      points: donutPoints,
    },
    {
      id: "mom-comparison",
      label: "مقارنة بالشهر السابق",
      chartVariant: "columns",
      points: momPoints,
    },
  ];

  const overallMomText =
    grandPrevMonthPaidCents > 0n
      ? (() => {
          const pct = Math.round(
            ((Number(grandMonthPaidCents) - Number(grandPrevMonthPaidCents)) /
              Number(grandPrevMonthPaidCents)) *
              100,
          );
          return pct >= 0
            ? `+${pct}% عن شهر ${prevMonthPrefix} (${displayMoney(grandPrevMonthPaidCents)} ج.م)`
            : `${pct}% عن شهر ${prevMonthPrefix} (${displayMoney(grandPrevMonthPaidCents)} ج.م)`;
        })()
      : `الشهر السابق (${prevMonthPrefix}): ${displayMoney(grandPrevMonthPaidCents)} ج.م`;

  return (
    <div className="fin-page">
      <Link href="/finance" className="fin-back no-print">
        <AppIcon name="arrow" />
        <span>العودة إلى المالية</span>
      </Link>

      <div className="fin-heading no-print">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            دليل البنود والرقابة على المصروفات
          </p>
          <h1>بنود المصروفات</h1>
          <p>
            إدارة دليل البنود المحاسبية مع فصلٍ دقيق بين المدفوع الفعلي والمعلّق، ومقارنة شهرية، وسجل تدقيق يوثّق كل تعديل بسببه ومنفِّذه.
          </p>
        </div>
        <div className="fin-actions">
          {canCreateExpense ? <Link className="fin-button" href="/finance/expenses/new">
            <AppIcon name="plusCircle" />
            <span>تسجيل مصروف</span>
          </Link> : null}
          <PrintPageButton
            label="طباعة دليل البنود"
            className="fin-button fin-button--secondary"
            title="طباعة دليل بنود المصروفات وتحليل الإنفاق"
          />
        </div>
      </div>

      <div className="no-print">
        <PantherSpotlightCard
          icon="expenseReceipt"
          chartVariant="bars"
          title="تحليل الإنفاق حسب البنود المحاسبية"
          subtitle={`شهر ${currentMonthPrefix} مقارنةً بشهر ${prevMonthPrefix}`}
          pill={`${activeCount} بند نشط من ${directoryItems.length}`}
          primary={{
            label: `المدفوع الفعلي بالشهر (${currentMonthPrefix})`,
            value: displayMoney(grandMonthPaidCents),
            unit: "ج.م",
            delta: overallMomText,
            tone:
              grandPrevMonthPaidCents > 0n &&
              grandMonthPaidCents > grandPrevMonthPaidCents
                ? "negative"
                : "positive",
          }}
          secondary={{
            label: "أعلى بند استهلاكًا بالشهر",
            value:
              topCat && topCat.monthPaidNum > 0
                ? topCat.monthPaidFormatted
                : displayMoney(grandMonthPendingCents),
            unit: "ج.م",
            delta:
              topCat && topCat.monthPaidNum > 0
                ? `${topCat.name} (${topCat.sharePct}% من مدفوعات الشهر)`
                : grandMonthPendingCents > 0n
                  ? "مصروفات تحت الإجراء هذا الشهر لم تُصرف بعد"
                  : `الإجمالي المدفوع تاريخيًا: ${displayMoney(grandAllTimePaidCents)} ج.م`,
            tone: "positive",
          }}
          series={spotlightSeries}
          actionHref="#categories-directory"
          actionLabel="استعراض دليل البنود وسجل التدقيق"
        />
      </div>

      <FinKpiStrip
        label="ملخص بنود المصروفات"
        className="no-print"
        items={[
          {
            icon: "expenses",
            label: "البنود النشطة بالدليل",
            value: (
              <>
                {activeCount} <small>من {directoryItems.length}</small>
              </>
            ),
            sub: `${inactiveCount} موقوف · ${unusedCount} غير مستخدم بعد`,
            tone: "accent",
          },
          {
            icon: "cash",
            label: `المدفوع الفعلي (${currentMonthPrefix})`,
            value: (
              <>
                <bdi dir="ltr">{displayMoney(grandMonthPaidCents)}</bdi>{" "}
                <small>ج.م</small>
              </>
            ),
            sub:
              grandMonthPendingCents > 0n
                ? `+ ${displayMoney(grandMonthPendingCents)} ج.م تحت الإجراء`
                : "بلا مصروفات معلّقة هذا الشهر",
          },
          {
            icon: "reports",
            label: "أعلى بند صرفًا بالشهر",
            value: (
              <span style={{ fontSize: "1.05rem" }}>
                {topCat && topCat.monthPaidNum > 0 ? topCat.name : "لا صرف بالشهر بعد"}
              </span>
            ),
            sub:
              topCat && topCat.monthPaidNum > 0
                ? `${topCat.monthPaidFormatted} ج.م (${topCat.sharePct}% من المدفوع)`
                : `إجمالي السجل المدفوع: ${displayMoney(grandAllTimePaidCents)} ج.م`,
          },
          {
            icon: "shield",
            label: "قيود تدقيق البنود",
            value: String(auditRows.length),
            sub: auditRows[0]
              ? `آخر قيد بواسطة ${auditRows[0].actorName}`
              : "كل إنشاء أو تعديل يُوثَّق بسببه",
          },
        ]}
      />

      {canCreateCategory ? <div className="fin-panel no-print" style={{ marginBottom: 18 }}>
        <div className="fin-panel__heading">
          <h2>إضافة بند مصروف جديد</h2>
          <p>
            البنود السابقة لا تُنسخ ولا تتأثر. يُرفض تكرار الاسم تلقائيًا ويُحفظ الإنشاء في سجل التدقيق.
          </p>
        </div>
        <div className="fin-panel__body">
          <CreateCategoryForm
            requestId={randomUUID()}
            existingNames={directoryItems.map((c) => c.name)}
          />
        </div>
      </div> : null}

      <CategoriesDirectoryView
        canEdit={canEditCategory}
        canCreateExpense={canCreateExpense}
        canOpenExpenses={canOpenExpenses}
        categories={directoryItems}
        auditRows={auditRows}
        currentMonthLabel={currentMonthPrefix}
        prevMonthLabel={prevMonthPrefix}
        seedRequestId={randomUUID()}
      />
    </div>
  );
}
