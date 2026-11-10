/* تقارير المالية (v1) — المدير والمحاسب فقط. لا تُدخِل صلاحيات ولا جداول جديدة؛
   كل قسم يقرأ من اللوحات الموجودة. «المبلغ الفعال» بعد أي تصحيح مؤكد في كل مكان.
   قسم الفترة يعرض: الإجمالي والفرق عن الفترة السابقة المكافئة + «الآن» بانتظار إجراء.
   (الطباعة مستبعدة في هذه النسخة؛ التصدير عبر CSV عام للتقرير عبر FinCsvButton.) */
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { prisma } from "@/lib/prisma";
import { listAccounts, listSettlements } from "@/lib/finance/engine";
import {
  loadExpenseFinanceReport,
  normalizeReportPeriod,
  REPORT_PERIOD_LABEL,
  REPORT_PERIOD_ORDER,
  formatReportCents,
  type FinanceExpenseReport,
  type ReportPeriod,
} from "@/lib/finance/reports";
import { displayMoney } from "@/lib/commerce-display";
import { financePage, financeRead } from "../page-context";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { accessKeyAllowed } from "@/lib/access-control";
import { FinKpiStrip } from "@/components/finance/fin-kpi-strip";
import { FinEmptyState } from "@/components/finance/fin-empty-state";
import { FinSectionTitle } from "@/components/finance/fin-section-title";
import { FinCsvButton } from "@/components/finance/fin-csv-button";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const todayFmt = (iso: string) => <bdi dir="ltr">{iso}</bdi>;

/** سلاسل pglite/المحرك دائمًا بصيغة ddd.dd — تكفي لجمع دقيق هنا للعرض فقط. */
function centsOf2dp(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = "00"] = body.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2));
  return negative ? -cents : cents;
}

function sumCents(values: string[]): bigint {
  return values.reduce((acc, v) => acc + centsOf2dp(v), 0n);
}

function signedMoney(cents: bigint): string {
  const sign = cents > 0n ? "+" : cents < 0n ? "-" : "±";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${displayMoney(abs)}`;
}

export default async function FinanceReportsPage({ searchParams }: Props) {
  const { session, canManage } = await financePage();
  if (!canManage) redirect("/finance");
  await requirePageAccess("/finance/reports");
  const access = await getAccessContext();
  const canViewFinance = accessKeyAllowed(access.hidden, "/finance");
  const canViewExpenses = accessKeyAllowed(access.hidden, "/finance/expenses");
  const canViewTransfers = accessKeyAllowed(access.hidden, "/finance/transfers");

  const rawPeriod = (await searchParams)?.period;
  const period = normalizeReportPeriod(Array.isArray(rawPeriod) ? rawPeriod[0] : rawPeriod);

  const [report, accounts, branches] = await Promise.all([
    financeRead(session, (tx) => loadExpenseFinanceReport(tx, period)),
    financeRead(session, (tx) => listAccounts({ serializable: (work) => work(tx) }, session.id)),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
  ]);

  const branchNames = new Map(branches.map((b) => [b.id.toString(), b.nameAr]));
  const openAccounts = accounts.filter((a) => !a.closedAt);
  const vaultAccounts = openAccounts.filter((a) => a.kind === "VAULT");
  const custodyAccounts = openAccounts.filter((a) => a.kind === "CUSTODY");
  const vaultTotal = sumCents(vaultAccounts.map((a) => a.balance));
  const custodyTotal = sumCents(custodyAccounts.map((a) => a.balance));
  const periodTotal = report.current.totalCents;
  const hasActivity = report.current.count > 0 || report.awaiting.pendingCount > 0 || report.awaiting.approvedCount > 0;

  const csvRows = buildCsvRows(report, {
    branchNameFor: (id: string) => branchNames.get(id) ?? "الفرع",
    vaultCount: vaultAccounts.length,
    custodyCount: custodyAccounts.length,
    vaultTotal,
    custodyTotal,
  });

  return (
    <div className="fin-page">
      {canViewFinance ? <Link href="/finance" className="fin-back no-print">
        <AppIcon name="arrow" />
        <span>العودة إلى المالية</span>
      </Link> : null}

      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            التقارير
          </p>
          <h1>تقارير المالية — {REPORT_PERIOD_LABEL[period]}</h1>
          <p>
            كل الأرقام «المبلغ الفعال» بعد أي تصحيح مؤكد. الفترة{" "}
            {todayFmt(report.range.from)} ← {todayFmt(report.range.to)} بتوقيت القاهرة،
            ومقارنتها بالفترة المكافئة {todayFmt(report.range.prevFrom)} ← {todayFmt(report.range.prevTo)}.
          </p>
        </div>
        <div className="fin-actions" role="group" aria-label="اختيار الفترة">
          {REPORT_PERIOD_ORDER.map((key) => (
            <Link
              key={key}
              href={`/finance/reports?period=${key}`}
              className={`fin-filter-pill${period === key ? " is-active" : ""}`}
              aria-current={period === key ? "true" : undefined}
            >
              <span>{REPORT_PERIOD_LABEL[key]}</span>
            </Link>
          ))}
        </div>
      </div>

      <FinKpiStrip
        label="نبض الفترة وما بانتظار إجراء"
        items={[
          {
            icon: "reports",
            label: `إجمالي مصروفات ${REPORT_PERIOD_LABEL[period]}`,
            value: (
              <>
                <bdi dir="ltr">{formatReportCents(report.current.totalCents)}</bdi> <small>ج.م</small>
              </>
            ),
            sub: (
              <>
                {report.current.count} مصروفًا · الفترة السابقة {formatReportCents(report.previous.totalCents)} · الفرق{" "}
                <bdi dir="ltr">{signedMoney(report.deltaCents)}</bdi>
              </>
            ),
            tone: "accent",
            href: canViewExpenses ? "/finance/expenses" : undefined,
          },
          {
            icon: "expenses",
            label: "الآن: بانتظار الاعتماد",
            value: (
              <>
                {report.awaiting.pendingCount} <small>طلب</small>
              </>
            ),
            sub: (
              <>
                بقيمة <bdi dir="ltr">{formatReportCents(report.awaiting.pendingCents)}</bdi> ج.م بانتظار قراركم
              </>
            ),
            tone: report.awaiting.pendingCount > 0 ? "alert" : "default",
            href: canViewExpenses ? "/finance/expenses" : undefined,
          },
          {
            icon: "check",
            label: "الآن: معتمدة بانتظار الصرف",
            value: (
              <>
                {report.awaiting.approvedCount} <small>معتمد</small>
              </>
            ),
            sub: (
              <>
                بقيمة <bdi dir="ltr">{formatReportCents(report.awaiting.approvedCents)}</bdi> ج.م جاهزة للصرف
              </>
            ),
            href: canViewExpenses ? "/finance/expenses" : undefined,
          },
          {
            icon: "transfers",
            label: "تسويات مفتوحة بانتظار القرار",
            value: String(report.settlements.openCount),
            sub:
              report.settlements.staleOpenCount > 0
                ? `${report.settlements.staleOpenCount} مضى عليها أكثر من ٧ أيام`
                : "لا تسويات متقادمة الآن",
            tone: report.settlements.openCount > 0 ? "alert" : "default",
            href: canViewTransfers ? "/finance/transfers#pending-settlements" : undefined,
          },
        ]}
      />

      {!hasActivity ? (
        <FinEmptyState icon="reports" title="لا مصروفات ولا طلبات في هذه الفترة">
          <p>
            لم تُسجِّل الفترة {REPORT_PERIOD_LABEL[period]} أي مصروف أو طلب معلّق حتى الآن؛
            غيّر الفترة من الأعلى أو واصل من «مصروفات اليوم» لرؤية حصاد العمل هنا.
          </p>
        </FinEmptyState>
      ) : null}

      <section className="fin-panel">
        <div className="fin-panel__heading">
          <FinSectionTitle
            as="h2"
            eyebrow="بنود الصرف"
            title={`أعلى بنود الصرف — ${REPORT_PERIOD_LABEL[period]}`}
            description="الحصة من إجمالي مدفوعات الفترة (المبلغ الفعال بعد أي تصحيح)."
          />
        </div>
        {report.topCategories.length === 0 ? (
          <div className="fin-panel__body">
            <p className="fin-field__hint">لا مصروفات في الفترة المجموعة بعد.</p>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <caption>أعلى ستة بنود صرفًا في الفترة مع حصتها من إجمالي المدفوع</caption>
              <thead>
                <tr>
                  <th scope="col">البند</th>
                  <th scope="col">العمليات</th>
                  <th scope="col">المدفوع الفعال</th>
                  <th scope="col">الحصة من الفترة</th>
                </tr>
              </thead>
              <tbody>
                {report.topCategories.map((category) => (
                  <tr key={category.name}>
                    <td>{category.name}</td>
                    <td>{category.count}</td>
                    <td>
                      <span className="fin-money">
                        <bdi dir="ltr">{formatReportCents(category.totalCents)}</bdi> ج.م
                      </span>
                    </td>
                    <td>
                      <div className="fin-cat-spend__line">
                        <strong className="fin-money">{category.sharePct}%</strong>
                        <span className="fin-cat-share-bar" role="presentation" aria-hidden="true">
                          <span style={{ width: `${Math.max(category.sharePct, 4)}%` }} />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fin-panel">
        <div className="fin-panel__heading">
          <FinSectionTitle
            as="h2"
            eyebrow="الفروع"
            title="مقارنة الفروع في الفترة"
            description="مدفوعات كل فرع من الفترة المختارة — بلا تواريخ آتية، للمراجعة وحدها."
          />
        </div>
        {report.branchSums.length === 0 ? (
          <div className="fin-panel__body">
            <p className="fin-field__hint">لا توجد فروع لها مصروفات في هذه الفترة.</p>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <caption>مقارنة مصروفات الفروع في الفترة المختارة</caption>
              <thead>
                <tr>
                  <th scope="col">الفرع</th>
                  <th scope="col">العمليات</th>
                  <th scope="col">المدفوع الفعال</th>
                  <th scope="col">الحصة من الفترة</th>
                </tr>
              </thead>
              <tbody>
                {report.branchSums.map((branch) => (
                  <tr key={branch.branchId}>
                    <td>{branchNames.get(branch.branchId) ?? "الفرع"}</td>
                    <td>{branch.count}</td>
                    <td>
                      <span className="fin-money">
                        <bdi dir="ltr">{formatReportCents(branch.totalCents)}</bdi> ج.م
                      </span>
                    </td>
                    <td>{periodTotal > 0n ? `${Math.round(Number((branch.totalCents * 1000n) / periodTotal)) / 10}%` : "0%"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fin-panel">
        <div className="fin-panel__heading">
          <FinSectionTitle
            as="h2"
            eyebrow="الآن"
            title="العُهد والخزائن لحظيًا"
            description="أرصدة دفترية حالية للحسابات المفتوحة — بلا سقوف تُخترع هنا؛ أي رافعة رقابية أخرى تعيش في شاشاتها."
          />
        </div>
        <div className="fin-panel__body">
          <FinKpiStrip
            label="أوضاع الخزائن والعُهد الآن"
            items={[
              {
                icon: "branch",
                label: "خزائن فروع مفتوحة",
                value: String(vaultAccounts.length),
                sub: "خزنة رئيسية لكل فرع نشط تفتقر؟ راجع «الحسابات النقدية»",
              },
              {
                icon: "cash",
                label: "إجمالي أرصدة الخزائن",
                value: (
                  <>
                    <bdi dir="ltr">{displayMoney(vaultTotal)}</bdi> <small>ج.م</small>
                  </>
                ),
                sub: "جمع الدفتري الحالي",
              },
              {
                icon: "cash",
                label: "عُهَد موظفين مفتوحة",
                value: String(custodyAccounts.length),
                sub: "خُزين الموظفين خارج الخزنة بيده",
              },
              {
                icon: "shield",
                label: "إجمالي أرصدة العُهَد",
                value: (
                  <>
                    <bdi dir="ltr">{displayMoney(custodyTotal)}</bdi> <small>ج.م</small>
                  </>
                ),
                sub: "جمع أرصدة العهد الدفترية",
              },
            ]}
          />
        </div>
      </section>

      <section className="fin-panel">
        <div className="fin-panel__heading fin-panel__heading--split">
          <div>
            <FinSectionTitle
              as="h2"
              eyebrow="التسويات"
              title={`تسويات الشهر الحالي`}
              description="كل تسوية عُدّت ضمن الشهر (بتوقيت القاهرة) مع فرقها عن مؤشر الفترة المسجّل."
            />
          </div>
          <FinCsvButton
            filename={`selahtone-finance-report-${period}-${report.today}.csv`}
            label="تصدير التقرير"
            headers={["المؤشر", "القيمة"]}
            rows={csvRows}
          />
        </div>
        <div className="fin-panel__body">
          <div className="fin-table-wrap">
            <table className="fin-table">
              <caption>تسويات الشهر الحالي: العدد والفرق المطلق عن المؤشر والمعلّق المتقادم</caption>
              <thead>
                <tr>
                  <th scope="col">المؤشر</th>
                  <th scope="col">القيمة</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">عدد التسويات هذا الشهر</th>
                  <td>{report.settlements.monthCount}</td>
                </tr>
                <tr>
                  <th scope="row">إجمالي الفرق المطلق عن المؤشر (|المعدود − المؤشر|)</th>
                  <td>
                    <span className="fin-money">
                      <bdi dir="ltr">{formatReportCents(report.settlements.monthAbsDeviationCents)}</bdi> ج.م
                    </span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">تسويات مفتوحة بانتظار القرار الآن</th>
                  <td>{report.settlements.openCount}</td>
                </tr>
                <tr>
                  <th scope="row">منها المتقادمة (أكثر من ٧ أيام منذ الطلب)</th>
                  <td>{report.settlements.staleOpenCount}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function buildCsvRows(
  report: FinanceExpenseReport,
  extras: {
    branchNameFor: (id: string) => string;
    vaultCount: number;
    custodyCount: number;
    vaultTotal: bigint;
    custodyTotal: bigint;
  },
): Array<[string, string]> {
  const periodLabel = REPORT_PERIOD_LABEL[report.period];
  const rows: Array<[string, string]> = [
    ["الفترة", `${periodLabel} (${report.range.from} ← ${report.range.to})`],
    ["إجمالي مصروفات الفترة", `${formatReportCents(report.current.totalCents)} ج.م · ${report.current.count} مصروفًا`],
    ["الفترة السابقة المكافئة", `${formatReportCents(report.previous.totalCents)} ج.م · ${report.previous.count} مصروفًا (${report.range.prevFrom} ← ${report.range.prevTo})`],
    ["فرق الفترة", `${signedMoney(report.deltaCents)} ج.م`],
    ["بانتظار الاعتماد الآن", `${report.awaiting.pendingCount} طلب · بقيمة ${formatReportCents(report.awaiting.pendingCents)} ج.م`],
    ["معتمدة بانتظار الصرف الآن", `${report.awaiting.approvedCount} معتمد · بقيمة ${formatReportCents(report.awaiting.approvedCents)} ج.م`],
  ];
  for (const category of report.topCategories) {
    rows.push([`أعلى بنود: ${category.name}`, `${formatReportCents(category.totalCents)} ج.م · ${category.sharePct}%`]);
  }
  for (const branch of report.branchSums) {
    rows.push([`فرع: ${extras.branchNameFor(branch.branchId)}`, `${formatReportCents(branch.totalCents)} ج.م · ${branch.count} مصروفًا`]);
  }
  rows.push(
    ["تسويات هذا الشهر", `${report.settlements.monthCount} · انحراف مطلق ${formatReportCents(report.settlements.monthAbsDeviationCents)} ج.م`],
    ["تسويات مفتوحة الآن", `${report.settlements.openCount} · المتقادمة ${report.settlements.staleOpenCount}`],
    ["خزائن مفتوحة", `${extras.vaultCount} · إجمالي ${displayMoney(extras.vaultTotal)} ج.م`],
    ["عُهَد مفتوحة", `${extras.custodyCount} · إجمالي ${displayMoney(extras.custodyTotal)} ج.م`],
  );
  return rows;
}
