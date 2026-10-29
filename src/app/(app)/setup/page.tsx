import { prisma } from "@/lib/prisma";
import { requireSession, canSeeAllBranches } from "@/lib/auth";
import { lineTax, money } from "@/lib/tax";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

/**
 * صفحة التحقق من الإعداد — تُستخدم كقائمة تحقق حيّة بعد كل خطوة.
 * كل صف = فحص فعلي على قاعدة البيانات، لا مجرد شرح.
 */
export default async function SetupPage() {
  const session = await requireSession();

  if (!canSeeAllBranches(session)) {
    return <div className="alert alert-err">هذه الصفحة للمدير والمحاسب فقط.</div>;
  }

  const [branches, users, taxRates, products, warehouses, expenseCategories, tax5] = await Promise.all([
    prisma.branch.count(),
    prisma.user.count(),
    prisma.taxRate.findMany({ orderBy: { rate: "asc" } }),
    prisma.product.count(),
    prisma.warehouse.findMany({ include: { branch: true } }),
    prisma.expenseCategory.count(),
    prisma.taxRate.findUnique({ where: { code: "VAT5" } }),
  ]);

  // فحص محرك الضريبة على بيانات حقيقية من القاعدة
  const vat14 = taxRates.find((t) => t.code === "VAT14");
  const comp8 = taxRates.find((t) => t.code === "COMP8");
  const tax5Check = tax5 ? lineTax(18500, [{ code: tax5.code, rate: Number(tax5.rate) / 100 }]) : null;
  const compoundCheck =
    vat14 && comp8
      ? lineTax(18500, [
          { code: vat14.code, rate: Number(vat14.rate) / 100 },
          { code: comp8.code, rate: Number(comp8.rate) / 100, compoundOnPrevious: true },
        ])
      : null;

  const checks: { label: string; ok: boolean; detail: string }[] = [
    {
      label: "اتصال قاعدة البيانات",
      ok: true,
      detail: "متصل — قرأنا البيانات أدناه الآن",
    },
    {
      label: "الفروع الثلاثة",
      ok: branches >= 3,
      detail: `${branches} فرع`,
    },
    {
      label: "مستودع لكل فرع",
      ok: warehouses.length >= branches && branches > 0,
      detail: warehouses.map((w) => `${w.branch.code}→${w.code}`).join(" · ") || "لا يوجد",
    },
    {
      label: "معدلات الضريبة",
      ok: taxRates.length >= 3,
      detail: taxRates.map((t) => `${t.code}=${Number(t.rate)}%`).join(" · "),
    },
    {
      label: "ضريبة الأجهزة الطبية 5% على 18,500",
      ok: tax5Check ? tax5Check.total === 925 : false,
      detail: tax5Check ? `${money(tax5Check.total)} ج (المتوقع 925.00)` : "معدل VAT5 غير موجود",
    },
    {
      label: "الضريبة المركّبة 14% ثم 8% = 4,277.20",
      ok: compoundCheck ? compoundCheck.total === 4277.2 : false,
      detail: compoundCheck ? `${money(compoundCheck.total)} ج (المتوقع 4,277.20)` : "مكوّن غير موجود",
    },
    {
      label: "الأصناف",
      ok: products > 0,
      detail: `${products} صنف`,
    },
    {
      label: "بنود المصروفات",
      ok: expenseCategories > 0,
      detail: `${expenseCategories} بند`,
    },
    {
      label: "المستخدمون",
      ok: users >= 3,
      detail: `${users} مستخدم`,
    },
  ];

  const passed = checks.filter((c) => c.ok).length;

  return (
    <>
      <div className={`alert ${passed === checks.length ? "alert-ok" : "alert-warn alert-info"}`}>
        <b>{passed} من {checks.length} فحصًا ناجحًا.</b>{" "}
        {passed === checks.length
          ? "الإعداد سليم — أرسل لي لقطة هذه الصفحة لننتقل للخطوة التالية."
          : "راجع البنود غير الناجحة مع المسؤول. لا تُشغّل تهيئة البيانات على قاعدة قائمة لأنها قد تغيّر بيانات حقيقية."}
      </div>

      <div className="card">
        <h2>قائمة التحقق الحيّة <span className="pill">{passed}/{checks.length}</span></h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th style={{ width: 40 }}>#</th><th>الفحص</th><th>النتيجة</th><th>التفصيل</th></tr>
            </thead>
            <tbody>
              {checks.map((c, i) => (
                <tr key={c.label}>
                  <td className="muted">{i + 1}</td>
                  <td>{c.label}</td>
                  <td>
                    <span className={`badge ${c.ok ? "b-ok" : "b-warn"}`}>{c.ok ? "✓ ناجح" : "! يحتاج مراجعة"}</span>
                  </td>
                  <td className="small muted">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>بيانات الفروع كما هي في القاعدة</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>الفرع</th><th>الكود</th><th>المدينة</th><th>المستودعات</th><th>تاريخ الإنشاء</th></tr>
            </thead>
            <tbody>
              {await prisma.branch.findMany({ include: { warehouses: true }, orderBy: { code: "asc" } }).then((bs) =>
                bs.map((b) => (
                  <tr key={b.id.toString()}>
                    <td>{b.nameAr}</td>
                    <td><code>{b.code}</code></td>
                    <td className="muted">{b.city ?? "—"}</td>
                    <td className="small">{b.warehouses.map((w) => w.code).join(" · ")}</td>
                    <td className="muted small">{new Date(b.createdAt).toLocaleDateString("ar-EG")}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          عدد المستخدمين: {nf.format(users)} — منهم مدير، محاسب، وموظف كاونتر للعريش.
        </p>
      </div>
    </>
  );
}
