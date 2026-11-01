import { NextResponse } from "next/server";

/**
 * ربط النطاق بتطبيق أندرويد — Digital Asset Links.
 *
 * بلا هذا الملف: يفتح تطبيق أندرويد (TWA) شريطَ المتصفح داخله، فلا يبدو
 * تطبيقًا. وبه: يتحقّق نظام أندرويد أن هذا النطاق يملك التطبيق، فيُخفي
 * الشريط ويُسنِد الروابط إليه.
 *
 * البصمة تُقرأ من البيئة ANDROID_SHA256 — بصمة SHA-256 لتوقيع التطبيق
 * (تُنتَج عند توقيعه). وإن لم تُضبط، تُعاد مصفوفة فارغة: فالملف يبقى
 * صحيح الشكل ولا يكسر شيئًا، إلى أن تُضبط البصمة.
 */
export const dynamic = "force-dynamic";

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME ?? "com.selahtone.erp";

export function GET() {
  const fingerprint = process.env.ANDROID_SHA256;

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprint ? [fingerprint] : [],
        },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
