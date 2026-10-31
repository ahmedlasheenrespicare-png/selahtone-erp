import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { branchScope, requireSession } from "@/lib/auth";
import { displayMoney, fixedScaled, METHOD_LABELS } from "@/lib/commerce-display";
import { customerPosition } from "@/lib/commerce-math";
import type { PaymentMethod } from "@/lib/commerce-validation";
import { scaledInteger } from "@/lib/inventory-math";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import MovementForm from "./movement-form";
import ReturnForm from "./return-form";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ saleId: string }> };
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });
const methodName = (method: string) => METHOD_LABELS[method as PaymentMethod] ?? "غير معروف";
type DetailEntry = { key: string; label: string; value: string };
/** لقطة الحقول النصية لبند الأصناف الفنية كما كتبها الموظف. */
function detailEntries(value: unknown): DetailEntry[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as { key?: unknown; label?: unknown; value?: unknown };
    return typeof row.label === "string" && typeof row.value === "string" ? [{ key: String(row.key ?? ""), label: row.label, value: row.value }] : [];
  });
}
const cents = (value: { toFixed: (scale: number) => string }) => scaledInteger(value.toFixed(2), 2);

export default async function SaleDetailPage({ params }: Props) {
  const session = await requireSession();
  const scope = branchScope(session);
  const id = positiveDatabaseId((await params).saleId);
  if (!id) notFound();
  const sale = await prisma.commerceSale.findFirst({
    where: { id: BigInt(id), ...(scope.branchId ? { branchId: BigInt(scope.branchId) } : {}) },
    include: {
      branch: { select: { nameAr: true } }, warehouse: { select: { nameAr: true } }, createdBy: { select: { fullName: true } },
      lines: { orderBy: { id: "asc" }, include: { returnLines: { select: { quantity: true } }, serialLinks: { include: { serial: { select: { serialNumber: true, currentSaleLineId: true } }, returnSerial: { select: { id: true } } } } } },
      collections: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { createdBy: { select: { fullName: true } } } },
      refunds: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { createdBy: { select: { fullName: true } } } },
      returns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { createdBy: { select: { fullName: true } }, lines: { include: { saleLine: { select: { nameSnapshot: true } }, serials: { include: { saleLineSerial: { include: { serial: { select: { serialNumber: true } } } } } } } } } },
    },
  });
  if (!sale) notFound();
  const original = cents(sale.total);
  const returned = sale.returns.flatMap((entry) => entry.lines).reduce((sum, line) => sum + cents(line.total), 0n);
  const collected = sale.collections.reduce((sum, entry) => sum + cents(entry.amount), 0n);
  const refunded = sale.refunds.reduce((sum, entry) => sum + cents(entry.amount), 0n);
  const balance = customerPosition({ originalTotalCents: original, returnedCents: returned, collectedCents: collected, refundedCents: refunded });
  const remainingLines = sale.lines.map((line) => {
    const previous = line.returnLines.reduce((sum, part) => sum + scaledInteger(part.quantity.toFixed(2), 2), 0n);
    const remaining = scaledInteger(line.quantity.toFixed(2), 2) - previous;
    return { id: line.id.toString(), name: line.nameSnapshot, quantity: line.quantity.toFixed(2), previouslyReturned: fixedScaled(previous), remaining: fixedScaled(remaining), total: line.total.toFixed(2), tax: (line.taxAmount ?? 0).toFixed(2), isStock: line.isStock, isSerialized: line.isSerialized,
      serials: line.serialLinks.filter((link) => !link.returnSerial && link.serial.currentSaleLineId === line.id).map((link) => ({ id: link.serialId.toString(), number: link.serial.serialNumber })) };
  });
  const hasReturns = sale.returns.length > 0;
  const allReturned = remainingLines.length > 0 && remainingLines.every((line) => scaledInteger(line.remaining, 2) === 0n);
  const status = sale.cancelledAt ? "ملغاة" : allReturned ? "مرتجعة بالكامل" : hasReturns ? "مرتجع جزئي" : "مؤكدة";
  const canRefund = session.role === "MANAGER" || session.role === "ACCOUNTANT";

  return <div className="inv-page sale-stack">
    <div className="inv-actions"><Link href="/sales" className="inv-button inv-button--text">العودة إلى الفواتير</Link><PrintButton /></div>
    <article className="inv-panel inv-panel__body sale-print" aria-labelledby="invoice-title">
      <p className="sale-print-watermark">إيصال داخلي للمراجعة — ليس فاتورة ضريبية إلكترونية رسمية.</p>
      <div className="sale-detail-head"><div><h2 id="invoice-title">فاتورة ST-{sale.id.toString()}</h2><p>{dateFormatter.format(sale.createdAt)} · سجّلها {sale.createdBy.fullName}</p></div><span className={`sale-chip ${sale.cancelledAt ? "sale-chip--neutral" : hasReturns ? "sale-chip--warning" : ""}`}>{status}</span></div>
      <dl className="sale-meta"><div><dt>العميل</dt><dd>{sale.customerName}</dd></div><div><dt>الهاتف</dt><dd><bdi dir="ltr">{sale.customerPhone}</bdi></dd></div><div><dt>الفرع</dt><dd>{sale.warehouse ? `${sale.branch.nameAr} — ${sale.warehouse.nameAr}` : sale.branch.nameAr}</dd></div></dl>
      <div className="inv-table-wrap table-wrap" role="region" aria-label="بنود الفاتورة" tabIndex={0}><table className="inv-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الضريبة المضمنة</th><th>الإجمالي</th></tr></thead><tbody>
        {sale.lines.map((line) => <tr key={line.id.toString()}><td><strong>{line.nameSnapshot}</strong><br /><span className="muted">{line.taxCodeSnapshot ? `${line.skuSnapshot ?? "—"} · ${line.taxCodeSnapshot} (${line.taxRateSnapshot?.toFixed(3) ?? "0.000"}%)` : "الضريبة غير محددة"}</span>{detailEntries(line.details).length > 0 && <div className="sale-note">{detailEntries(line.details).map((entry) => `${entry.label}: ${entry.value}`).join(" · ")}</div>}{line.serialLinks.length > 0 && <div className="sale-note">{line.serialLinks.map((link) => `${link.serial.serialNumber}${link.returnSerial ? " (مرتجع)" : ""}`).join(" · ")}</div>}</td>
          <td><bdi dir="ltr">{line.quantity.toFixed(2)}</bdi></td><td><bdi dir="ltr">{displayMoney(cents(line.unitPrice))}</bdi></td><td><bdi dir="ltr">{displayMoney(cents(line.discount))}</bdi></td><td><bdi dir="ltr">{line.taxAmount === null ? "غير محددة" : displayMoney(cents(line.taxAmount))}</bdi></td><td><bdi dir="ltr">{displayMoney(cents(line.total))}</bdi></td></tr>)}
      </tbody></table></div>
      <div className="sale-grid" style={{ marginTop: 18 }}><div><h3>التحصيل والمرتجعات</h3><ul className="sale-ledger">
        {sale.collections.map((entry) => <li key={`payment-${entry.id}`}><span>{entry.isInitial ? "الدفعة الأولى" : "تحصيل"} · {methodName(entry.method)} · {entry.createdBy.fullName} · {dateFormatter.format(entry.createdAt)}</span><strong>{displayMoney(cents(entry.amount))} ج.م</strong></li>)}
        {sale.returns.map((entry) => <li key={`return-${entry.id}`}><span>{entry.isCancellation ? "إلغاء" : "مرتجع"} · {entry.createdBy.fullName} · {dateFormatter.format(entry.createdAt)}<br />{entry.lines.map((line) => `${line.saleLine.nameSnapshot} × ${line.quantity.toFixed(2)}${line.serials.length ? ` (${line.serials.map((s) => s.saleLineSerial.serial.serialNumber).join("، ")})` : ""}`).join(" · ")}</span><strong>−{displayMoney(entry.lines.reduce((sum, line) => sum + cents(line.total), 0n))} ج.م</strong></li>)}
        {sale.refunds.map((entry) => <li key={`refund-${entry.id}`}><span>رد مسجل بعد الدفع · {methodName(entry.method)} · {entry.createdBy.fullName} · {dateFormatter.format(entry.createdAt)}</span><strong>{displayMoney(cents(entry.amount))} ج.م</strong></li>)}
      </ul></div><dl className="sale-totals"><div><dt>قيمة الأصناف</dt><dd>{displayMoney(cents(sale.subtotal))} ج.م</dd></div><div><dt>الخصم</dt><dd>{displayMoney(cents(sale.discount))} ج.م</dd></div><div><dt>الضريبة ضمن السعر</dt><dd>{sale.taxTotal === null ? "غير محددة" : `${displayMoney(cents(sale.taxTotal))} ج.م`}</dd></div><div className="sale-totals__strong"><dt>إجمالي الفاتورة الأصلي</dt><dd>{displayMoney(original)} ج.م</dd></div><div><dt>قيمة المرتجعات</dt><dd>{displayMoney(returned)} ج.م</dd></div><div><dt>المحصّل</dt><dd>{displayMoney(collected)} ج.م</dd></div><div><dt>الرد المسجل بعد الدفع</dt><dd>{displayMoney(refunded)} ج.م</dd></div><div><dt>المتبقي على العميل</dt><dd>{displayMoney(balance.dueFromCustomerCents)} ج.م</dd></div><div><dt>مستحق للعميل ولم يُدفع بعد</dt><dd>{displayMoney(balance.dueToCustomerCents)} ج.م</dd></div></dl></div>
      <p className="sale-note">المبلغ المستحق للعميل لا يُعد مدفوعًا حتى يُسجّل الرد بعد الدفع الفعلي. النظام لا ينفذ تحويلات مالية.</p>
    </article>
    <div className="sale-grid"><div className="sale-stack">
      {session.role === "MANAGER" && <ReturnForm requestId={randomUUID()} saleId={id} lines={remainingLines} originalCents={original.toString()} returnedCents={returned.toString()} collectedCents={collected.toString()} refundedCents={refunded.toString()} unavailable={Boolean(sale.cancelledAt) || allReturned} />}
    </div><div className="sale-stack">
      <MovementForm mode="collect" saleId={id} requestId={randomUUID()} maximum={balance.dueFromCustomerCents.toString()} />
      {canRefund && <MovementForm mode="refund" saleId={id} requestId={randomUUID()} maximum={balance.dueToCustomerCents.toString()} />}
    </div></div>
  </div>;
}
