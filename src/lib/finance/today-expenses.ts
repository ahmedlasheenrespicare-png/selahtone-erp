import "server-only";

/**
 * مصروفات اليوم للوحة القيادة: نفس بيانات «سجل المصروفات» (/finance/expenses)
 * لكن مخصصة للبطاقات — لا تعيد استخدام listExpenses لأن حدود رؤيتها (الخاصة لكل موظف)
 * لا تطابق القاعدة المطلوبة هنا: المدير والمحاسب لكل الفروع أو للفرع المختار في نطاق
 * اللوحة (عبر المعامل `scopeBranchId`)، وموظف الكاونتر فرعه فقط.
 *
 * «اليوم» = عمود expense_date بتوقيت القاهرة، بأي حالة (بانتظار الاعتماد/معتمد/مدفوع).
 * المبالغ تُعرض بعد آخر تصحيح مالي إن وجد (نفس COALESCE المعتمد في listExpenses).
 *
 * بصمت تظهر البطاقة دائمًا في اللوحة؛ إن كانت وحدة المالية مطفأة في البيئة الحالية
 * تُرجع null ويُظهر واجهة اللوحة حالة «يتطلب تفعيل وحدة المالية». ولا تُشغّل أي استعلام حينها.
 */
import type { SessionUser } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { cairoDate } from "@/lib/finance/validation";
import { displayMoney, METHOD_LABELS } from "@/lib/commerce-display";

export type TodayExpenseStatus = "PENDING" | "APPROVED" | "PAID";

export type TodayExpenseRow = {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  categorySnapshot: string;
  description: string;
  beneficiary: string | null;
  status: TodayExpenseStatus;
  statusLabel: string;
  requestedByName: string;
  approvedByName: string | null;
  paymentMethodLabel: string | null;
  amount: bigint;
  amountFormatted: string;
};

export type TodayExpensesSummary = {
  rows: TodayExpenseRow[];
  totalCents: bigint;
  totalFormatted: string;
  paidCents: bigint;
  paidFormatted: string;
  waitingCents: bigint;
  waitingFormatted: string;
  count: number;
  paidCount: number;
  pendingCount: number;
  approvedCount: number;
};

const STATUS_LABEL: Record<TodayExpenseStatus, string> = {
  PENDING: "بانتظار الاعتماد",
  APPROVED: "معتمد",
  PAID: "مدفوع",
};

function toCents(value: string): bigint {
  const negative = value.trim().startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0"));
}

/**
 * @param session حساب المشاهد الحالي.
 * @param scopeBranchId فرع نطاق العرض (مثل وضع اللوحة المركّزة)؛ للمدير/المحاسب فقط.
 *   مرّر `null` لعرض كل الفروع (سلوك «كل الفروع النشطة»)، وتجاهل المعامل للكاونتر (فرعه دائمًا).
 */
export async function loadTodayExpenses(
  session: SessionUser,
  scopeBranchId?: string | null,
): Promise<TodayExpensesSummary | null> {
  if (!financeEnabled()) return null;

  const isManager = session.role === "MANAGER" || session.role === "ACCOUNTANT";
  // الموظف يرى مصروفات فرعه فقط ولا يتأثر بالمعامل؛ أي دور/حساب بلا فرع لا يرى شيئًا
  // (حالة فارغة طبيعية). المدير/المحاسب بلا معامل يرون كل الفروع كما هو اليوم.
  const branchFilterId = isManager
    ? scopeBranchId ?? null
    : session.role === "CS_AGENT"
      ? session.branchId ?? null
      : undefined;
  if (branchFilterId === undefined || (session.role === "CS_AGENT" && !branchFilterId)) return null;

  const today = cairoDate();
  return financeDb.serializable(async (tx) => {
    await assertFinanceActor(tx, {
      id: session.id,
      role: session.role,
      branchId: session.branchId,
    });
    const { rows } = await tx.query<{
      id: string;
      branchId: string;
      branchName: string;
      branchCode: string;
      categorySnapshot: string;
      amount: string;
      description: string;
      beneficiary: string | null;
      status: TodayExpenseStatus;
      requestedByName: string;
      approvedByName: string | null;
      paymentMethod: string | null;
    }>(
      `SELECT e.id::text AS "id", e.branch_id::text AS "branchId", b.name_ar AS "branchName", b.code AS "branchCode",
              e.category_snapshot AS "categorySnapshot",
              COALESCE((SELECT c.after_amount FROM finance.expense_corrections c WHERE c.expense_id=e.id ORDER BY c.id DESC LIMIT 1), e.amount)::text AS "amount",
              e.description, e.beneficiary, e.status,
              COALESCE(ru.full_name, '—') AS "requestedByName", ru2.full_name AS "approvedByName",
              p.method AS "paymentMethod"
         FROM finance.expenses e
         JOIN public.branches b ON b.id = e.branch_id
         JOIN public.users ru ON ru.id = e.requested_by
         LEFT JOIN public.users ru2 ON ru2.id = e.approved_by
         LEFT JOIN finance.payments p ON p.expense_id = e.id
        WHERE e.expense_date = $1::date
          AND ($2::text IS NULL OR e.branch_id = $2::bigint)
        ORDER BY e.created_at DESC, e.id DESC`,
      [today, branchFilterId],
    );

    let totalCents = 0n;
    let paidCents = 0n;
    let waitingCents = 0n;
    let paidCount = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    const mapped: TodayExpenseRow[] = rows.map((row) => {
      const amount = toCents(row.amount);
      totalCents += amount;
      if (row.status === "PAID") { paidCents += amount; paidCount += 1; } else { waitingCents += amount; }
      if (row.status === "PENDING") pendingCount += 1;
      if (row.status === "APPROVED") approvedCount += 1;
      return {
        id: row.id,
        branchId: row.branchId,
        branchName: row.branchName,
        branchCode: row.branchCode,
        categorySnapshot: row.categorySnapshot,
        description: row.description,
        beneficiary: row.beneficiary,
        status: row.status,
        statusLabel: STATUS_LABEL[row.status] ?? row.status,
        requestedByName: row.requestedByName,
        approvedByName: row.approvedByName,
        paymentMethodLabel: row.paymentMethod && row.paymentMethod in METHOD_LABELS
          ? METHOD_LABELS[row.paymentMethod as keyof typeof METHOD_LABELS]
          : row.paymentMethod,
        amount,
        amountFormatted: displayMoney(amount),
      };
    });

    return {
      rows: mapped,
      totalCents,
      totalFormatted: displayMoney(totalCents),
      paidCents,
      paidFormatted: displayMoney(paidCents),
      waitingCents,
      waitingFormatted: displayMoney(waitingCents),
      count: mapped.length,
      paidCount,
      pendingCount,
      approvedCount,
    };
  });
}
