import Link from "next/link";
import DashboardWallet, { type WalletPocketItem } from "@/app/(app)/dashboard/dashboard-wallet";
import MonthlySalesPanther from "@/app/(app)/dashboard/monthly-sales-panther";
import { AppIcon } from "@/components/app-icon";
import PantherSpotlightCard from "@/components/panther-spotlight-card";
import { branchScope, requireSession } from "@/lib/auth";
import { customerPosition } from "@/lib/commerce-math";
import { displayMoney } from "@/lib/commerce-display";
import { scaledInteger } from "@/lib/inventory-math";
import { prisma } from "@/lib/prisma";
import {
  loadCollectionsSpotlight,
  loadSalesChartSeries,
  loadSalesStats,
} from "@/lib/sales-stats";
import SalesInvoicesView, { type SalesInvoiceRow, type SalesInvoiceStatusKind } from "./sales-invoices-view";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Cairo",
});
const monthFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  month: "long",
  year: "numeric",
  timeZone: "Africa/Cairo",
});
const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

type WalletInvoiceCard = SalesInvoiceRow & {
  netCollectedFormatted: string;
  itemPills: Array<{ name: string; qty: string }>;
  extraItemsCount: number;
};

function formatLineQty(raw: string): string {
  return raw.endsWith(".00") ? raw.slice(0, -3) : raw.replace(/(\.\d*[1-9])0+$/, "$1");
}

export default async function SalesPage() {
  const session = await requireSession();
  const scope = branchScope(session);
  const canSell = session.role === "MANAGER" || session.role === "CS_AGENT";

  const [sales, monthSalesData] = await Promise.all([
    prisma.commerceSale.findMany({
      where: scope.branchId ? { branchId: BigInt(scope.branchId) } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        branch: { select: { nameAr: true } },
        collections: { select: { amount: true } },
        refunds: { select: { amount: true } },
        returns: { select: { lines: { select: { total: true } } } },
        lines: { select: { nameSnapshot: true, quantity: true, returnLines: { select: { quantity: true } } } },
      },
    }),
    Promise.all([
      loadSalesStats(prisma, scope.branchId ?? null, "month"),
      loadSalesChartSeries(prisma, scope.branchId ?? null, "month"),
      loadCollectionsSpotlight(prisma, scope.branchId ?? null, {
        canSell,
        context: "sales",
      }),
    ]).catch((error) => {
      console.error("sales: monthly stats failed", error);
      return [null, [], null] as const;
    }),
  ]);

  const [monthSales, monthSalesSeries, collectionsSpotlight] = monthSalesData;
  const currentMonthLabel = monthFormatter.format(new Date());
  const monthTotalNum = monthSales ? Number(monthSales.total) : 0;
  const monthOutstandingNum = monthSales ? Number(monthSales.outstandingTotal) : 0;
  const monthOutstandingPct =
    monthTotalNum > 0
      ? Math.min(100, Math.round((monthOutstandingNum / monthTotalNum) * 1000) / 10)
      : 0;
  const monthCollectedPct =
    monthTotalNum > 0 ? Math.max(0, Math.round((100 - monthOutstandingPct) * 10) / 10) : 0;

  let activeInvoicesCount = 0;
  let netInvoicedCents = 0n;
  let netCollectedCents = 0n;
  let totalDueFromCustomerCents = 0n;
  let totalDueToCustomerCents = 0n;

  const branchSet = new Set<string>();

  const cards: WalletInvoiceCard[] = sales.map((sale) => {
    const returned = sale.returns
      .flatMap((entry) => entry.lines)
      .reduce((sum, line) => sum + scaledInteger(line.total.toFixed(2), 2), 0n);
    const collected = sale.collections.reduce((sum, entry) => sum + scaledInteger(entry.amount.toFixed(2), 2), 0n);
    const refunded = sale.refunds.reduce((sum, entry) => sum + scaledInteger(entry.amount.toFixed(2), 2), 0n);
    const netCollected = collected - refunded;
    const original = scaledInteger(sale.total.toFixed(2), 2);
    const netInvoice = original - returned;
    const balance = customerPosition({
      originalTotalCents: original,
      returnedCents: returned,
      collectedCents: collected,
      refundedCents: refunded,
    });
    const hasReturns = sale.lines.some((line) => line.returnLines.length > 0);
    const allReturned =
      sale.lines.length > 0 &&
      sale.lines.every(
        (line) =>
          line.returnLines.reduce((sum, item) => sum + scaledInteger(item.quantity.toFixed(2), 2), 0n) ===
          scaledInteger(line.quantity.toFixed(2), 2),
      );

    const statusKind: SalesInvoiceStatusKind = sale.cancelledAt
      ? "cancelled"
      : allReturned
        ? "full_return"
        : hasReturns
          ? "partial_return"
          : "confirmed";

    const statusLabel =
      statusKind === "cancelled"
        ? "ملغاة"
        : statusKind === "full_return"
          ? "مرتجعة بالكامل"
          : statusKind === "partial_return"
            ? "مرتجع جزئي"
            : "مؤكدة";

    if (!sale.cancelledAt) {
      activeInvoicesCount += 1;
      netInvoicedCents += netInvoice;
    }

    netCollectedCents += netCollected;
    totalDueFromCustomerCents += balance.dueFromCustomerCents;
    totalDueToCustomerCents += balance.dueToCustomerCents;
    branchSet.add(sale.branch.nameAr);

    const itemPills = sale.lines.slice(0, 3).map((line) => ({
      name: line.nameSnapshot,
      qty: formatLineQty(line.quantity.toFixed(2)),
    }));
    const ageDays = Math.max(
      0,
      Math.floor((Date.now() - sale.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
    );

    return {
      id: sale.id.toString(),
      code: `ST-${sale.id.toString()}`,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      branchName: sale.branch.nameAr,
      originalFormatted: displayMoney(original),
      netCollectedFormatted: displayMoney(netCollected),
      dueFromCustomerFormatted: displayMoney(balance.dueFromCustomerCents),
      dueToCustomerFormatted: displayMoney(balance.dueToCustomerCents),
      hasDueFromCustomer: balance.dueFromCustomerCents > 0n,
      hasDueToCustomer: balance.dueToCustomerCents > 0n,
      statusLabel,
      statusKind,
      createdAtFormatted: dateFormatter.format(sale.createdAt),
      createdAtIso: sale.createdAt.toISOString(),
      ageDays,
      linesCount: sale.lines.length,
      itemPills,
      extraItemsCount: Math.max(0, sale.lines.length - 3),
    };
  });

  const rows: SalesInvoiceRow[] = cards.map(
    ({ netCollectedFormatted: _net, itemPills: _pills, extraItemsCount: _extra, ...row }) => row,
  );
  const latestWalletInvoices = cards.slice(0, 12);
  const branches = Array.from(branchSet);

  const pocketItems: WalletPocketItem[] = [
    {
      key: "net-invoiced",
      label: "صافي الفواتير",
      value: `${displayMoney(netInvoicedCents)} ج.م`,
      kind: "money",
    },
    {
      key: "net-collected",
      label: "صافي المحصّل",
      value: `${displayMoney(netCollectedCents)} ج.م`,
      kind: "money",
    },
    ...(totalDueFromCustomerCents > 0n
      ? [
          {
            key: "customer-due",
            label: "متبقي العملاء",
            value: `${displayMoney(totalDueFromCustomerCents)} ج.م`,
            kind: "money" as const,
          },
        ]
      : []),
    {
      key: "active-count",
      label: "فواتير نشطة",
      value: String(activeInvoicesCount),
      kind: "count",
    },
  ];

  return (
    <div className="inv-page">
      <div className="inv-heading">
        <div>
          <p className="inv-heading__eyebrow">
            <span className="sales-eyebrow-dot" aria-hidden="true" />
            المبيعات والتحصيل
          </p>
          <h1>المبيعات والفواتير</h1>
          <p>مبيعات الفروع المتاحة لحسابك، والتحصيلات والمبالغ المستحقة.</p>
        </div>
        <div className="inv-actions">
          {session.role === "MANAGER" && (
            <Link className="inv-button inv-button--secondary" href="/sales/stats">
              <AppIcon name="reports" />
              <span>إحصائيات المبيعات</span>
            </Link>
          )}
          {session.role === "MANAGER" && (
            <Link className="inv-button inv-button--secondary" href="/sales/catalog">
              <AppIcon name="products" />
              <span>أصناف البيع</span>
            </Link>
          )}
          {session.role === "MANAGER" && (
            <Link className="inv-button inv-button--secondary" href="/sales/settings">
              <AppIcon name="settings" />
              <span>حد خصم الموظف</span>
            </Link>
          )}
          {canSell && (
            <Link className="inv-button" href="/sales/new">
              <span className="inv-button__plus" aria-hidden="true">+</span>
              <span>بيع جديد</span>
            </Link>
          )}
        </div>
      </div>

      {(latestWalletInvoices.length > 0 || monthSales) && (
        <div className="dashboard-cards-grid" aria-label="حافظة الفواتير ومؤشرات المبيعات والتحصيل">
          {latestWalletInvoices.length > 0 ? (
            <div className="dashboard-cards-grid__wallet">
              <DashboardWallet
                balanceValue={`${displayMoney(netInvoicedCents)} ج.م`}
                balanceLabel="صافي الفواتير"
                pocketItems={pocketItems}
                hint="اسحب البطاقات أفقيًا أو استخدم الأسهم لتقليب أحدث الفواتير، ومرّر على الجيب لإظهار الملخص"
              >
                {latestWalletInvoices.map((invoice) => {
                  const settlementNote = invoice.hasDueFromCustomer
                    ? "متبقٍ على العميل"
                    : invoice.hasDueToCustomer
                      ? "مستحق رد للعميل"
                      : invoice.statusKind === "cancelled"
                        ? "فاتورة ملغاة"
                        : "مسددة بالكامل";

                  return (
                    <article key={invoice.id} className="stat-card">
                      <div className="stat-card__head">
                        <h3>
                          <bdi dir="ltr">{invoice.code}</bdi> — {invoice.customerName}
                        </h3>
                        <p>
                          {invoice.branchName} · {invoice.createdAtFormatted}
                          {invoice.customerPhone ? (
                            <>
                              {" "}
                              · <bdi dir="ltr">{invoice.customerPhone}</bdi>
                            </>
                          ) : null}
                        </p>
                        <span className="stat-card__badge">{invoice.statusLabel}</span>
                      </div>

                      <div className="stat-card__body">
                        {invoice.itemPills.length > 0 && (
                          <div className="sales-wallet-items" aria-label="بنود الفاتورة">
                            {invoice.itemPills.map((pill, idx) => (
                              <span key={`${invoice.id}-pill-${idx}`} className="sales-wallet-item-pill">
                                <span>{pill.name}</span>
                                <strong>×{pill.qty}</strong>
                              </span>
                            ))}
                            {invoice.extraItemsCount > 0 && (
                              <span className="sales-wallet-item-pill">
                                +{invoice.extraItemsCount} بنود أخرى
                              </span>
                            )}
                          </div>
                        )}

                        <div className="stat-grid">
                          <div className="stat-grid__item">
                            <span className="stat-grid__label">إجمالي الفاتورة</span>
                            <strong className="stat-grid__value">
                              <bdi dir="ltr">{invoice.originalFormatted}</bdi> <small>ج.م</small>
                            </strong>
                          </div>

                          <div className="stat-grid__item">
                            <span className="stat-grid__label">صافي المحصّل</span>
                            <strong className="stat-grid__value">
                              <bdi dir="ltr">{invoice.netCollectedFormatted}</bdi> <small>ج.م</small>
                            </strong>
                          </div>

                          <div className="stat-grid__item">
                            <span className="stat-grid__label">
                              {invoice.hasDueToCustomer ? "مستحق للعميل" : "المتبقي على العميل"}
                            </span>
                            <strong className="stat-grid__value">
                              <bdi dir="ltr">
                                {invoice.hasDueToCustomer
                                  ? invoice.dueToCustomerFormatted
                                  : invoice.dueFromCustomerFormatted}
                              </bdi>{" "}
                              <small>ج.م</small>
                            </strong>
                          </div>

                          <div className="stat-grid__item">
                            <span className="stat-grid__label">موقف السداد</span>
                            <strong className="stat-grid__value">
                              <small>{settlementNote}</small>
                            </strong>
                          </div>

                          <Link
                            href={`/sales/${invoice.id}`}
                            className="stat-grid__item is-link sales-wallet-action-link"
                          >
                            <span className="stat-grid__label">
                              عرض تفاصيل الفاتورة والطباعة أو تسجيل التحصيل والمرتجع
                            </span>
                            <strong className="stat-grid__value">
                              فتح الفاتورة <bdi dir="ltr">{invoice.code}</bdi>
                            </strong>
                            <AppIcon name="arrow" className="stat-grid__arrow" />
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </DashboardWallet>
            </div>
          ) : null}

          {monthSales ? (
            <div className="dashboard-cards-grid__item">
              <MonthlySalesPanther
                monthLabel={currentMonthLabel}
                totalFormatted={nf.format(Number(monthSales.total))}
                outstandingFormatted={nf.format(Number(monthSales.outstandingTotal))}
                averageFormatted={nf.format(Number(monthSales.averageInvoice))}
                invoiceCount={nf.format(monthSales.invoiceCount)}
                outstandingCount={nf.format(monthSales.outstandingCount)}
                hasOutstanding={monthOutstandingNum > 0}
                collectedPercent={monthCollectedPct}
                outstandingPercent={monthOutstandingPct}
                hasSales={monthSales.invoiceCount > 0}
                series={monthSalesSeries}
                reportHref={
                  session.role === "MANAGER"
                    ? "/sales/stats?period=month"
                    : canSell
                      ? "/sales/new"
                      : "/sales"
                }
                reportLabel={
                  session.role === "MANAGER"
                    ? "عرض التقرير الكامل لمبيعات الشهر"
                    : canSell
                      ? "تسجيل فاتورة بيع جديدة"
                      : "تحديث سجل الفواتير"
                }
              />
            </div>
          ) : null}

          {collectionsSpotlight ? (
            <div className="dashboard-cards-grid__item">
              <PantherSpotlightCard
                layout="wallet"
                icon="customerCollection"
                title={collectionsSpotlight.title}
                subtitle={collectionsSpotlight.subtitle}
                pill={collectionsSpotlight.pill}
                primary={collectionsSpotlight.primary}
                secondary={collectionsSpotlight.secondary}
                series={collectionsSpotlight.series}
                actionHref={collectionsSpotlight.actionHref}
                actionLabel={collectionsSpotlight.actionLabel}
              />
            </div>
          ) : null}
        </div>
      )}

      <section className="sales-kpi-strip" aria-label="ملخص الفواتير المعروضة">
        <article className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="receipt" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">الفواتير النشطة</span>
            <strong className="sales-kpi-card__value">{activeInvoicesCount}</strong>
            <small className="sales-kpi-card__sub">من إجمالي {sales.length} في السجل</small>
          </div>
        </article>

        <article className="sales-kpi-card is-accent">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="sales" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">صافي قيمة الفواتير</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{displayMoney(netInvoicedCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">بعد خصم المرتجعات والملغى</small>
          </div>
        </article>

        <article className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">صافي المحصّل الفعلي</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{displayMoney(netCollectedCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">التحصيلات ناقص المبالغ المردودة</small>
          </div>
        </article>

        <article className={`sales-kpi-card${totalDueFromCustomerCents > 0n ? " is-alert" : ""}`}>
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="check" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">المتبقي على العملاء</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{displayMoney(totalDueFromCustomerCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">
              {totalDueToCustomerCents > 0n
                ? `ومستحق للعملاء: ${displayMoney(totalDueToCustomerCents)} ج.م`
                : "رصيد ذمم الفواتير المعروضة"}
            </small>
          </div>
        </article>
      </section>

      <div className="inv-alert sales-tax-banner">
        <AppIcon name="receipt" />
        <span>الإيصالات داخلية وليست فواتير ضريبية إلكترونية. راجع المعالجة الضريبية للأصناف مع المحاسب قبل التشغيل الفعلي.</span>
      </div>

      {!rows.length ? (
        <div className="inv-panel inv-empty sales-empty-state">
          <span className="sales-empty-state__icon" aria-hidden="true">
            <AppIcon name="receipt" />
          </span>
          <h2>لا توجد فواتير مسجلة في نطاق حسابك</h2>
          <p>ابدأ بتسجيل أول عملية بيع ليظهر سجل الفواتير والتحصيلات هنا مباشرةً.</p>
          {canSell && (
            <Link className="inv-button" href="/sales/new">
              <span className="inv-button__plus" aria-hidden="true">+</span>
              <span>تسجيل بيع جديد</span>
            </Link>
          )}
        </div>
      ) : (
        <>
          <div id="sales-directory" className="sales-directory-heading">
            <h2>جدول الفواتير الكامل</h2>
            <span>بحث فوري برقم الفاتورة أو اسم العميل أو الهاتف وتصفية بالفرع والحالة</span>
          </div>
          <SalesInvoicesView rows={rows} branches={branches} />
          <p className="inv-page__foot">
            يظهر آخر 100 فاتورة في نطاق حسابك. المبلغ المستحق للعميل لا يعني أن رده تم فعليًا إلا بعد تسجيل الرد.
          </p>
        </>
      )}
    </div>
  );
}
