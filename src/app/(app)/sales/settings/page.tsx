import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SettingForm from "./setting-form";

export const dynamic = "force-dynamic";
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });
export default async function SalesSettingsPage() {
  const session = await requireSession();
  if (session.role !== "MANAGER") return <div className="inv-page"><div className="inv-alert inv-alert--error">تعديل حد الخصم متاح للمدير فقط.</div><Link className="inv-back" href="/sales">العودة إلى الفواتير</Link></div>;
  const [setting, changes] = await Promise.all([prisma.commerceSettings.findUnique({ where: { id: 1 } }), prisma.commerceSettingsChange.findMany({ take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { createdBy: { select: { fullName: true } } } })]);
  return <div className="inv-page sale-stack"><Link className="inv-back" href="/sales">← العودة إلى الفواتير</Link><div className="inv-heading"><div><p className="inv-heading__eyebrow">إعدادات البيع</p><h1>حدود الخصم</h1><p>الحد نسبة من قيمة أصناف الفاتورة قبل الخصم: حدٌّ للموظف والمحاسب، وسقفٌ أعلى للمدير وحده. تُسجّل التغييرات باسم المدير.</p></div></div>
    {!setting ? <div className="inv-alert inv-alert--error">إعداد الخصم غير موجود. لا يمكن حفظ حد جديد قبل مراجعة الإعداد.</div> : <SettingForm requestId={randomUUID()} initialPercent={(setting.staffDiscountBps / 100).toString()} initialManagerPercent={(setting.managerDiscountBps / 100).toString()} />}
    {changes.length > 0 && <section className="inv-panel inv-panel__body"><h2>آخر التغييرات</h2><ul className="sale-ledger">{changes.map((change) => <li key={change.id.toString()}><span>{change.createdBy.fullName} · {dateFormatter.format(change.createdAt)}</span><strong>الموظف {change.staffDiscountBps / 100}% · المدير {change.managerDiscountBps / 100}%</strong></li>)}</ul></section>}
  </div>;
}
