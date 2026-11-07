/* مكوّنات «تفاصيل التثبيت» (pin groups) المشتركة بين لوحة التحكم وصفحة سجل مبيعات اليوم —
   كل نقطة تحمل مفتاح تثبيت — يُستخدم لوفئة العرض الافتراضية أو التثبيت.
   بلا أرقام مُخترعة: المواصفات تُعرض من بيانات النقطة نفسها. */
import Link from "next/link";
import type { PantherChartSeries } from "@/components/panther-spotlight-card";
import type { CollectionsDetails, CollectionsInvoiceRow } from "@/lib/sales-stats";

/* مجموعات تثبيت: تضيف لكل نقطة pinKey إن لم يوجد (سلسلة قابلة للوسم قبل التمرير). */
export function withPinKeys(series: ReadonlyArray<PantherChartSeries>): PantherChartSeries[] {
  return series.map((s) => ({
    ...s,
    points: s.points.map((p, i) => ({
      ...p,
      pinKey: p.pinKey ?? `${s.id}:${i}`,
    })),
  }));
}

const pinToken = (name: string) => encodeURIComponent(name);

/* مجموعات عامة تُعرض كمواصفات من بيانات النقطة نفسها */
export function PinGroups({ series }: { series: ReadonlyArray<PantherChartSeries> }) {
  return (
    <div className="collections-pins collections-pins--generic">
      {series.map((s) =>
        s.points.map((pt, idx) => (
          <div
            key={`${s.id}:${idx}`}
            data-pin-part={`${s.id}:${idx}`}
            className="collections-pin-group"
          >
            <header className="collections-pin-group__head">
              <span>{pt.label}</span>
              <span className="collections-pin-group__tab">{s.label}</span>
            </header>
            <dl className="collections-pin-group__stats collections-pin-group__stats--rows">
              <div>
                <dt>القيمة</dt>
                <dd>
                  <bdi dir="ltr">{pt.formattedValue}</bdi>
                </dd>
              </div>
              {pt.secondaryFormatted ? (
                <div>
                  <dt>{pt.secondaryLabel ?? "القيمة الإضافية"}</dt>
                  <dd>
                    <bdi dir="ltr">{pt.secondaryFormatted}</bdi>
                  </dd>
                </div>
              ) : null}
            </dl>
            {pt.detail ? <p className="collections-pin-group__note">{pt.detail}</p> : null}
          </div>
        )),
      )}
    </div>
  );
}

function InvoiceRowItem({
  row,
  amount,
  canOpenIt,
}: {
  row: CollectionsInvoiceRow;
  amount: "net" | "remaining";
  canOpenIt: boolean;
}) {
  const inner = (
    <>
      <span className="dash-today-invoice__id" dir="ltr">
        <bdi>ST-{row.saleId}</bdi>
      </span>
      <span className="dash-today-invoice__main">
        <span className="dash-today-invoice__customer">{row.customerName}</span>
        <span className="dash-today-invoice__meta">
          {row.branchName} · {row.createdAtShort}
          {row.hasRemaining ? ` · متبقٍّ ${row.remainingFormatted} ج.م` : " · مسددة"}
        </span>
      </span>
      <span className="dash-today-invoice__amount">
        <bdi dir="ltr">{amount === "net" ? row.netFormatted : row.remainingFormatted}</bdi> ج.م
      </span>
    </>
  );
  return (
    <li className="dash-today-invoice">
      {canOpenIt ? (
        <Link href={`/sales/${row.saleId}`} className="dash-today-invoice__link">
          {inner}
        </Link>
      ) : (
        <div className="dash-today-invoice__link is-static">{inner}</div>
      )}
    </li>
  );
}

/* تفاصيل «التحصيل والعملاء»: مقسّمة حسب موقف السداد (مسددة/عليها باقٍ/مرتجعات) ثم العملاء ثم الفروع. */
export function CollectionsPinGroups({
  details,
  canOpenInvoice,
}: {
  details: CollectionsDetails;
  canOpenInvoice: boolean;
}) {
  const { settled, due, returns } = details;
  return (
    <div className="collections-pins">
      <section data-pin-part="settlement:settled" className="collections-pin-group" aria-label="فواتير مسدّدة بالكامل">
        <header className="collections-pin-group__head">
          <span>الفواتير المسدّدة بالكامل</span>
          <span className="collections-pin-group__count">{settled.length + details.settledMore} فاتورة</span>
        </header>
        {settled.length === 0 ? (
          <p className="collections-pin-group__note">لا توجد فواتير مسددة بالكامل ضمن النطاق المعروض.</p>
        ) : (
          <ul className="dash-today-invoice-list">
            {settled.map((row) => (
              <InvoiceRowItem key={row.saleId} row={row} amount="net" canOpenIt={canOpenInvoice} />
            ))}
          </ul>
        )}
        {details.settledMore > 0 ? (
          <p className="collections-pin-group__note">وهناك +{details.settledMore} فاتورة أخرى مسددة ضمن نطاقك — تُعرض الأحدث.</p>
        ) : null}
      </section>

      <section data-pin-part="settlement:due" className="collections-pin-group collections-pin-group--warn" aria-label="فواتير عليها باقٍ للتحصيل">
        <header className="collections-pin-group__head">
          <span>فواتير عليها باقٍ للتحصيل</span>
          <span className="collections-pin-group__count collections-pin-group__count--warn">{due.length + details.dueMore} فاتورة</span>
        </header>
        {due.length === 0 ? (
          <p className="collections-pin-group__note">لا توجد فواتير عليها باقٍ ضمن النطاق المعروض.</p>
        ) : (
          <ul className="dash-today-invoice-list">
            {due.map((row) => (
              <InvoiceRowItem key={row.saleId} row={row} amount="remaining" canOpenIt={canOpenInvoice} />
            ))}
          </ul>
        )}
        {details.dueMore > 0 ? (
          <p className="collections-pin-group__note">وهناك +{details.dueMore} فاتورة أخرى عليها باقٍ — تُعرض الأعلى قيمة.</p>
        ) : null}
      </section>

      <section data-pin-part="settlement:returns" className="collections-pin-group collections-pin-group--danger" aria-label="مرتجعات الفواتير النشطة">
        <header className="collections-pin-group__head">
          <span>مرتجعات الفواتير النشطة</span>
          <span className="collections-pin-group__count collections-pin-group__count--danger">
            {returns.length === 0 ? 0 : `${returns.length}+`} مرتجع
          </span>
        </header>
        {returns.length === 0 ? (
          <p className="collections-pin-group__note">لا توجد مرتجعات مسجلة ضمن النطاق المعروض.</p>
        ) : (
          <ul className="dash-today-invoice-list">
            {returns.map((row) => {
              const inner = (
                <>
                  <span className="dash-today-invoice__id" dir="ltr">
                    <bdi>ST-{row.saleId}</bdi>
                  </span>
                  <span className="dash-today-invoice__main">
                    <span className="dash-today-invoice__customer">{row.customerName}</span>
                    <span className="dash-today-invoice__meta">
                      {row.branchName} · {row.at}
                    </span>
                  </span>
                  <span className="dash-today-refund__amount">
                    <bdi dir="ltr">{row.amountFormatted}</bdi> ج.م
                  </span>
                </>
              );
              return (
                <li key={row.saleId} className="dash-today-invoice">
                  {canOpenInvoice ? (
                    <Link href={`/sales/${row.saleId}`} className="dash-today-invoice__link">
                      {inner}
                    </Link>
                  ) : (
                    <div className="dash-today-invoice__link is-static">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="collections-pin-group__note">تُحتسب المرتجعات على الفاتورة الأصلية — افتح الفاتورة للمراجعة.</p>
      </section>

      {details.customers.map((c) => (
        <section
          key={c.name}
          data-pin-part={`cust:${pinToken(c.name)}`}
          className="collections-pin-group"
          aria-label={c.name}
        >
          <header className="collections-pin-group__head">
            <span>{c.name}</span>
            <span className="collections-pin-group__count">{c.count} فاتورة</span>
          </header>
          <dl className="collections-pin-group__stats">
            <div>
              <dt>صافي الفواتير</dt>
              <dd>
                <bdi dir="ltr">{c.invoicedFormatted}</bdi> ج.م
              </dd>
            </div>
            <div>
              <dt>المحصّل فعليًا</dt>
              <dd>
                <bdi dir="ltr">{c.collectedFormatted}</bdi> ج.م
              </dd>
            </div>
            <div>
              <dt>المتبقي عليه</dt>
              <dd className={c.dueFormatted !== "0.00" ? "is-outstanding" : undefined}>
                <bdi dir="ltr">{c.dueFormatted}</bdi> ج.م
              </dd>
            </div>
          </dl>
          {c.invoices.length > 0 ? (
            <ul className="dash-today-invoice-list">
              {c.invoices.map((row) => (
                <InvoiceRowItem key={row.saleId} row={row} amount="remaining" canOpenIt={canOpenInvoice} />
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      {details.branches.map((b) => (
        <section
          key={b.branchId}
          data-pin-part={`branch:${pinToken(b.name)}`}
          className="collections-pin-group"
          aria-label={b.name}
        >
          <header className="collections-pin-group__head">
            <span>{b.name}</span>
            <span className="collections-pin-group__count">
              {b.count} فاتورة · {b.collectionRatePct}% محصّل
            </span>
          </header>
          <dl className="collections-pin-group__stats">
            <div>
              <dt>صافي الفواتير</dt>
              <dd>
                <bdi dir="ltr">{b.invoicedFormatted}</bdi> ج.م
              </dd>
            </div>
            <div>
              <dt>المحصّل فعليًا</dt>
              <dd>
                <bdi dir="ltr">{b.collectedFormatted}</bdi> ج.م
              </dd>
            </div>
            <div>
              <dt>المتبقي</dt>
              <dd className={b.dueFormatted !== "0.00" ? "is-outstanding" : undefined}>
                <bdi dir="ltr">{b.dueFormatted}</bdi> ج.م
              </dd>
            </div>
          </dl>
          {b.invoices.length > 0 ? (
            <ul className="dash-today-invoice-list">
              {b.invoices.map((row) => (
                <InvoiceRowItem key={row.saleId} row={row} amount="remaining" canOpenIt={canOpenInvoice} />
              ))}
            </ul>
          ) : (
            <p className="collections-pin-group__note">لا فواتير مسجلة ضمن نطاق عرضك لهذا الفرع.</p>
          )}
        </section>
      ))}
    </div>
  );
}
