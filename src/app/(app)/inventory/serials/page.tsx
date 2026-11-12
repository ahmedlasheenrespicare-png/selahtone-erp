import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { branchScope, requireSession } from "@/lib/auth";
import { escapeLikeLiteral, latinDigits, positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import { requirePageAccess } from "@/lib/access-control-server";
import { inventorySerialColumns, type InventorySerialRow } from "../inventory-registers-metadata";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string | string[]; before?: string | string[] }> };
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Cairo" });

export default async function SerialsPage({ searchParams }: Props) {
  await requirePageAccess("/inventory/serials");

  const session = await requireSession();
  const scope = branchScope(session);
  const params = await searchParams;
  const rawSearch = typeof params.q === "string" ? params.q.normalize("NFKC").trim() : "";
  const invalidSearch = rawSearch.length > 80 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(rawSearch);
  const search = invalidSearch ? "" : latinDigits(rawSearch).toUpperCase();
  const before = typeof params.before === "string" ? positiveDatabaseId(params.before) : null;
  const serials = invalidSearch ? [] : await prisma.inventorySerial.findMany({
    where: {
      ...(scope.branchId ? { OR: [
        { opening: { warehouse: { branchId: BigInt(scope.branchId) } } },
        { receipt: { warehouse: { branchId: BigInt(scope.branchId) } } },
      ] } : {}),
      ...(search ? { serialKey: { contains: escapeLikeLiteral(search) } } : {}),
      ...(before ? { id: { lt: BigInt(before) } } : {}),
    },
    orderBy: { id: "desc" },
    take: 51,
    include: {
      opening: { include: { product: { select: { nameAr: true, sku: true } }, warehouse: { select: { nameAr: true, branch: { select: { nameAr: true } } } } } },
      receipt: { include: { product: { select: { nameAr: true, sku: true } }, warehouse: { select: { nameAr: true, branch: { select: { nameAr: true } } } } } },
    },
  });
  const hasMore = serials.length > 50;
  const visible = serials.slice(0, 50);
  const nextParams = new URLSearchParams();
  if (search) nextParams.set("q", rawSearch);
  if (hasMore) nextParams.set("before", visible[visible.length - 1].id.toString());
  const rows: InventorySerialRow[] = visible.map((serial) => {
    const source = serial.opening ?? serial.receipt;
    return {
      id: serial.id.toString(),
      serialNumber: serial.serialNumber,
      productName: source?.product.nameAr ?? null,
      sku: source?.product.sku ?? null,
      branchName: source?.warehouse.branch.nameAr ?? null,
      warehouseName: source?.warehouse.nameAr ?? null,
      isSold: Boolean(serial.currentSaleLineId),
      createdAtFormatted: dateFormatter.format(serial.createdAt),
    };
  });

  return <div className="inv-page">
    <Link href="/inventory" className="inv-back"><AppIcon name="arrow" /> العودة إلى المخزون</Link>
    <div className="inv-heading"><div><p className="inv-heading__eyebrow">تتبع الأجهزة</p><h1>سجل السيريالات</h1><p>الأرقام المسجلة ضمن الأرصدة الافتتاحية والتوريدات في نطاق حسابك.</p></div></div>
    <div className="inv-alert">تُعرض حالة البيع الحالية لكل جهاز. نقل الأجهزة بين المستودعات غير مدعوم في هذه النسخة.</div>
    <section className="inv-panel" aria-labelledby="serials-list-title">
      <div className="inv-panel__heading"><h2 id="serials-list-title">الأرقام المسجّلة</h2><p>يمكنك البحث عن رقم كامل أو جزء منه.</p></div>
      <div className="inv-panel__body">
        <form className="inv-search" action="/inventory/serials" method="get">
          <label className="sr-only" htmlFor="serial-search">البحث برقم السيريال</label>
          <input id="serial-search" name="q" dir="ltr" defaultValue={rawSearch.slice(0, 80)} maxLength={80} placeholder="بحث برقم السيريال" aria-invalid={invalidSearch} aria-describedby={invalidSearch ? "serial-search-error" : undefined} />
          <button className="inv-button" type="submit">بحث</button>
          {rawSearch && <Link href="/inventory/serials" className="inv-button inv-button--secondary">مسح البحث</Link>}
        </form>
        {invalidSearch ? <div id="serial-search-error" className="inv-alert inv-alert--error" role="alert">أدخل بحثًا لا يزيد على 80 حرفًا ودون رموز تحكم.</div> : visible.length ? <DataTable
          rows={rows}
          columns={inventorySerialColumns}
          rowKey={(row) => row.id}
          regionLabel="جدول الأرقام التسلسلية"
          regionClassName="inv-table-wrap"
          tableClassName="inv-table"
        /> : <div className="inv-empty" role="status">لا توجد أرقام مسجّلة مطابقة في نطاق حسابك.</div>}
        {hasMore && <div className="inv-actions" style={{ marginTop: 16 }}><Link className="inv-button inv-button--secondary" href={`/inventory/serials?${nextParams.toString()}`}>عرض الأرقام التالية</Link></div>}
      </div>
    </section>
  </div>;
}
