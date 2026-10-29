/**
 * ============================================================
 *  بيانات البداية — تُشغّل مرة واحدة: npm run db:seed
 *  تنشئ: الفروع الثلاثة + مستودع افتراضي لكل فرع + معدلات الضريبة
 *         + بنود المصروفات + مستخدمين تجريبيين (كلمات مرور مؤقتة)
 *  ⚠ غيّر كلمات المرور فورًا بعد أول دخول.
 * ============================================================
 */
import "dotenv/config";
import { PrismaClient, RoleCode, ProductCategory, TaxKind } from "@prisma/client";
import bcrypt from "bcryptjs";
import { newPasswordSchema } from "../src/lib/auth-validation";

const prisma = new PrismaClient();

const BRANCHES = [
  { code: "ARH", nameAr: "فرع العريش", city: "العريش" },
  { code: "SHM", nameAr: "فرع الشيخ زويد", city: "الشيخ زويد" },
  { code: "BID", nameAr: "فرع بئر العبد", city: "بئر العبد" },
];

const TAX_RATES = [
  { code: "EXEMPT", nameAr: "معفى من الضريبة", rate: 0, kind: TaxKind.EXEMPT, isDefault: true },
  { code: "VAT5", nameAr: "ضريبة جدول — أجهزة طبية 5%", rate: 5, kind: TaxKind.SCHEDULE, isDefault: false },
  { code: "VAT14", nameAr: "القيمة المضافة — السعر العام 14%", rate: 14, kind: TaxKind.VAT, isDefault: false },
  { code: "COMP8", nameAr: "مكوّن إضافي 8% (يُحسب تراكميًا على 14%)", rate: 8, kind: TaxKind.COMPOSITE, isDefault: false },
  { code: "VAT22", nameAr: "ضريبة 22% أحادية (للتحقق فقط)", rate: 22, kind: TaxKind.VAT, isDefault: false },
];

const PRODUCTS = [
  {
    sku: "HA-PHK-A30", nameAr: "سماعة Phonak Audéo A30", category: ProductCategory.HEARING_AID,
    brand: "Phonak", model: "A30", purchaseCost: 11000, salePrice: 18500, taxCode: "VAT5", isSerialized: true,
  },
  {
    sku: "AC-BAT-312", nameAr: "بطارية 312 — علبة 6", category: ProductCategory.ACCESSORY,
    brand: "PowerOne", model: "312", purchaseCost: 30, salePrice: 45, taxCode: "VAT14", isSerialized: false,
  },
  {
    sku: "SP-EAR-MOLD", nameAr: "قطعة أذن مخصصة", category: ProductCategory.SPARE_PART,
    brand: null, model: "MOLD", purchaseCost: 120, salePrice: 600, taxCode: "VAT14", isSerialized: false,
  },
  {
    sku: "SV-CAL-01", nameAr: "جلسة ضبط وتعيير", category: ProductCategory.SERVICE,
    brand: null, model: null, purchaseCost: 0, salePrice: 150, taxCode: "VAT14", isSerialized: false,
  },
];

const EXPENSE_CATEGORIES = [
  { code: "RENT", nameAr: "إيجار الفروع" },
  { code: "UTILITIES", nameAr: "كهرباء ومياه وإنترنت" },
  { code: "SALARIES", nameAr: "رواتب وأجور" },
  { code: "PETTY", nameAr: "مصروفات نثرية" },
  { code: "SPARE_PARTS", nameAr: "قطع غيار وأدوات صيانة" },
  { code: "MARKETING", nameAr: "تسويق ودعاية" },
  { code: "MAINT", nameAr: "صيانة وإصلاحات" },
];

async function main() {
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword || !newPasswordSchema.safeParse(seedPassword).success) {
    throw new Error("اضبط SEED_PASSWORD بكلمة مرور مؤقتة من 12 حرفًا على الأقل ولا تزيد على 72 بايت قبل التهيئة.");
  }
  console.log("▶ بدء تهيئة البيانات…");

  // 1) معدلات الضريبة
  for (const t of TAX_RATES) {
    await prisma.taxRate.upsert({
      where: { code: t.code },
      update: { nameAr: t.nameAr, rate: t.rate, kind: t.kind, isDefault: t.isDefault },
      create: t,
    });
  }
  console.log(`  ✓ معدلات الضريبة: ${TAX_RATES.length}`);

  // 2) الفروع + مستودع افتراضي لكل فرع
  for (const b of BRANCHES) {
    const branch = await prisma.branch.upsert({
      where: { code: b.code },
      update: { nameAr: b.nameAr, city: b.city },
      create: { code: b.code, nameAr: b.nameAr, city: b.city, invoicePrefix: b.code },
    });

    await prisma.warehouse.upsert({
      where: { code: `${b.code}-W1` },
      update: {},
      create: {
        code: `${b.code}-W1`,
        nameAr: `${b.nameAr} — المستودع الرئيسي`,
        branchId: branch.id,
        isDefault: true,
        holdsStock: true,
      },
    });
  }
  console.log(`  ✓ الفروع والمستودعات: ${BRANCHES.length}`);

  // 3) المنتجات
  for (const p of PRODUCTS) {
    const tax = await prisma.taxRate.findUnique({ where: { code: p.taxCode } });
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: { salePrice: p.salePrice, purchaseCost: p.purchaseCost, taxRateId: tax?.id ?? null },
      create: {
        sku: p.sku,
        nameAr: p.nameAr,
        category: p.category,
        brand: p.brand,
        model: p.model,
        purchaseCost: p.purchaseCost,
        salePrice: p.salePrice,
        isSerialized: p.isSerialized,
        taxRateId: tax?.id ?? null,
      },
    });
  }
  console.log(`  ✓ المنتجات: ${PRODUCTS.length}`);

  // 4) بنود المصروفات
  for (const c of EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { code: c.code },
      update: { nameAr: c.nameAr },
      create: { code: c.code, nameAr: c.nameAr },
    });
  }
  console.log(`  ✓ بنود المصروفات: ${EXPENSE_CATEGORIES.length}`);

  // 5) المستخدمون التجريبيون
  const arh = await prisma.branch.findUnique({ where: { code: "ARH" } });

  const users: { email: string; fullName: string; role: RoleCode; branchId: bigint | null }[] = [
    { email: "manager@selahtone.local", fullName: "مدير الشركة", role: RoleCode.MANAGER, branchId: null },
    { email: "accountant@selahtone.local", fullName: "المحاسب العام", role: RoleCode.ACCOUNTANT, branchId: null },
    { email: "arh@selahtone.local", fullName: "كاونتر العريش", role: RoleCode.CS_AGENT, branchId: arh?.id ?? null },
  ];

  const hash = await bcrypt.hash(seedPassword, 12);
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        fullName: u.fullName,
        roleCode: u.role,
        branchId: u.branchId,
        passwordHash: hash,
        mustChangePassword: true,
        status: "ACTIVE",
      },
    });
  }
  console.log(`  ✓ المستخدمون: ${users.length} (المستخدمون الجدد سيغيرون كلمات المرور عند أول دخول؛ الحسابات الموجودة لم تتغير)`);

  console.log("\n✅ اكتملت التهيئة. سجّل الدخول ثم غيّر كلمات المرور فورًا.\n");
}

main()
  .catch((e) => {
    console.error("✗ فشل التهيئة:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
