import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { branchScope, requireSession } from "@/lib/auth";
import { escapeLikeLiteral, latinDigits, positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string | string[]; before?: string | string[] }> };
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Cairo" });

export default async function SerialsPage({ searchParams }: Props) {
  const session = await requireSession();
  const scope = branchScope(session);
  const params = await searchParams;
  const rawSearch = typeof params.q === "string" ? params.q.normalize("NFKC").trim() : "";
  const invalidSearch = rawSearch.length > 80 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(rawSearch);
  const search = invalidSearch ? "" : latinDigits(rawSearch).toUpperCase();
  const before = typeof params.before === "string" ? positiveDatabaseId(params.before) : null;
  const serials = invalidSearch ? [] : await prisma.inventorySerial.findMany({
    where: {
      ...(scope.branchId ? { opening: { warehouse: { branchId: BigInt(scope.branchId) } } } : {}),
      ...(search ? { serialKey: { contains: escapeLikeLiteral(search) } } : {}),
      ...(before ? { id: { lt: BigInt(before) } } : {}),
    },
    orderBy: { id: "desc" },
    take: 51,
    include: { opening: { include: { product: { select: { nameAr: true, sku: true } }, warehouse: { select: { nameAr: true, branch: { select: { nameAr: true } } } } } } },
  });
  const hasMore = serials.length > 50;
  const visible = serials.slice(0, 50);
  const nextParams = new URLSearchParams();
  if (search) nextParams.set("q", rawSearch);
  if (hasMore) nextParams.set("before", visible[visible.length - 1].id.toString());

  return <div className="inv-page">
    <Link href="/inventory" className="inv-back"><AppIcon name="arrow" /> العودة إلى المخزون</Link>
    <div className="inv-heading"><div><p className="inv-heading__eyebrow">تتبع الأجهزة</p><h1>سجل السيريالات</h1><p>الأرقام المسجلة ضمن الأرصدة الافتتاحية في نطاق حسابك.</p></div></div>
    <div className="inv-alert">يعرض السجل مدخلات البداية فقط؛ حركات البيع والنقل لم تُفعّل بعد.</div>
    <section className="inv-panel" aria-labelledby="serials-list-title">
      <div className="inv-panel__heading"><h2 id="serials-list-title">الأرقام المسجّلة</h2><p>يمكنك البحث عن رقم كامل أو جزء منه.</p></div>
      <div className="inv-panel__body">
        <form className="inv-search" action="/inventory/serials" method="get">
          <label className="sr-only" htmlFor="serial-search">البحث برقم السيريال</label>
          <input id="serial-search" name="q" dir="ltr" defaultValue={rawSearch.slice(0, 80)} maxLength={80} placeholder="بحث برقم السيريال" />
          <button className="inv-button" type="submit">بحث</button>
          {rawSearch && <Link href="/inventory/serials" className="inv-button inv-button--secondary">مسح البحث</Link>}
        </form>
        {invalidSearch ? <div className="inv-alert inv-alert--error" role="alert">أدخل بحثًا لا يزيد على 80 حرفًا ودون رموز تحكم.</div> : visible.length ? <div className="inv-table-wrap" role="region" aria-label="جدول الأرقام التسلسلية" tabIndex={0}>
          <table className="inv-table"><thead><tr><th scope="col">الرقم التسلسلي</th><th scope="col">الصنف</th><th scope="col">الفرع</th><th scope="col">المستودع</th><th scope="col">تاريخ التسجيل</th></tr></thead>
            <tbody>{visible.map((serial) => <tr key={serial.id.toString()}>
              <td><bdi dir="ltr">{serial.serialNumber}</bdi></td>
              <td>{serial.opening.product.nameAr} <span className="muted">({serial.opening.product.sku})</span></td>
              <td>{serial.opening.warehouse.branch.nameAr}</td><td>{serial.opening.warehouse.nameAr}</td>
              <td>{dateFormatter.format(serial.createdAt)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="inv-empty">لا توجد أرقام مسجّلة مطابقة في نطاق حسابك.</div>}
        {hasMore && <div className="inv-actions" style={{ marginTop: 16 }}><Link className="inv-button inv-button--secondary" href={`/inventory/serials?${nextParams.toString()}`}>عرض الأرقام التالية</Link></div>}
      </div>
    </section>
  </div>;
}
