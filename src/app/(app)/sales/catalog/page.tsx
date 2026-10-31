import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { listCatalogAudit, loadSalesCatalog } from "@/lib/catalog-sales";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { prisma } from "@/lib/prisma";
import {
  CatalogCreateForms, CategoryActiveForm, CategoryEditForm,
  FieldActiveForm, FieldEditForm, TypeActiveForm, TypeEditForm,
} from "./catalog-forms";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });
const ENTITY_LABEL: Record<string, string> = { CATEGORY: "تصنيف", TYPE: "نوع", FIELD: "حقل" };
const ACTION_LABEL: Record<string, string> = { CREATE: "إضافة", UPDATE: "تعديل", ACTIVATE: "تشغيل", DEACTIVATE: "إيقاف" };

export default async function SalesCatalogPage() {
  await requireMenuScopeAccess("/sales/catalog");
  const session = await requireSession();
  if (session.role !== "MANAGER") {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">إدارة أصناف البيع متاحة للمدير فقط.</div><Link href="/sales" className="inv-back">العودة إلى الفواتير</Link></div>;
  }
  const [catalog, audit] = await Promise.all([
    loadSalesCatalog(prisma, true),
    listCatalogAudit(prisma, BigInt(session.id), 40),
  ]);
  return <div className="inv-page">
    <Link href="/sales" className="inv-back">← العودة إلى الفواتير</Link>
    <div className="inv-heading"><div>
      <p className="inv-heading__eyebrow">إعداد البيع</p><h1>أصناف البيع</h1>
      <p>التصنيفات والأنواع والحقول التي يراها الموظف في شاشة البيع. لا حذف أبدًا: الإيقاف فقط، وكل تغيير يُسجَّل بسببه.</p>
    </div></div>
    <div className="inv-alert">إيقاف تصنيف يوقف كل أنواعه، وإيقاف نوع يوقف اختياره في البيع الجديد. الفواتير القديمة تبقى كما سُجّلت.</div>

    {!catalog.length ? <div className="inv-panel inv-empty">لا توجد أصناف بعد. أضف التصنيف الأول من النموذج أدناه.</div> : <div className="sale-stack">
      {catalog.map((category) => <section className="inv-panel" key={category.id} aria-labelledby={`cat-${category.id}`}>
        <div className="inv-panel__heading"><h2 id={`cat-${category.id}`}>{category.name}</h2>
          <p>الرمز <bdi dir="ltr">{category.code}</bdi> · {category.isActive ? "نشط" : "موقوف"} · {category.types.length} نوعًا</p></div>
        <div className="inv-panel__body sale-stack">
          <CategoryEditForm id={category.id} nameLabel={`اسم تصنيف ${category.name}`} initialName={category.name} initialSort={category.sortOrder} submitLabel="حفظ التصنيف" />
          <CategoryActiveForm id={category.id} active={category.isActive} reasonLabel={`سبب تغيير حالة تصنيف ${category.name}`} />
          {category.types.map((type) => <div className="sale-product" key={type.id}>
            <div className="sale-product__heading"><div><h3>{type.name}</h3>
              <p>{type.isActive ? "نشط" : "موقوف"} · {type.fields.length} حقلًا</p></div></div>
            <TypeEditForm id={type.id} nameLabel={`اسم نوع ${type.name}`} initialName={type.name} initialSort={type.sortOrder} submitLabel="حفظ النوع" />
            <TypeActiveForm id={type.id} active={type.isActive} reasonLabel={`سبب تغيير حالة نوع ${type.name}`} />
            {type.fields.map((field) => <div className="sale-product" key={field.id}>
              <div className="sale-product__heading"><div><h4>{field.label}</h4>
                <p><bdi dir="ltr">{field.key}</bdi> · {field.required ? "لازم" : "اختياري"} · {field.isActive ? "نشط" : "موقوف"}</p></div></div>
              <FieldEditForm id={field.id} nameLabel={`عنوان حقل ${field.label}`} initialName={field.label} initialSort={field.sortOrder} initialRequired={field.required} submitLabel="حفظ الحقل" />
              <FieldActiveForm id={field.id} active={field.isActive} reasonLabel={`سبب تغيير حالة حقل ${field.label}`} />
            </div>)}
          </div>)}
        </div>
      </section>)}
    </div>}

    <div className="sale-grid">
      <div className="sale-stack"><CatalogCreateForms
        categories={catalog.map((category) => ({ id: category.id, label: category.name }))}
        types={catalog.flatMap((category) => category.types.map((type) => ({ id: type.id, label: `${category.name} — ${type.name}` })))}
      /></div>
      <aside className="inv-side"><h2>سجل التغييرات</h2>
        {!audit.length ? <p>لا تغييرات مسجلة بعد.</p> : <ul className="sale-ledger">{audit.map((row) => <li key={row.id}>
          <span>{ENTITY_LABEL[row.entity] ?? row.entity} · {ACTION_LABEL[row.action] ?? row.action} · {row.actor} · {dateFormatter.format(row.createdAt)}<br />{row.reason}</span>
          <strong><bdi dir="ltr">#{row.entityId}</bdi></strong></li>)}</ul>}
        <p>الأصل محفوظ قبل كل تعديل وبعده، ولا يُحذف أي صنف من السجل.</p></aside>
    </div>
  </div>;
}
