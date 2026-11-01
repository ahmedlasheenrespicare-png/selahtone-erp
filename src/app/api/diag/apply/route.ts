/**
 * مسار إصلاح مؤقت — يُحذف فور نجاحه.
 *
 * ينفّذ هجرة «إقفال العهدة» من اتصال التطبيق نفسه، فلا بحث عن الفرع ولا احتمال
 * إصابة قاعدة أخرى. النص ثابت في الملف ولا يُقرأ من الطلب، فلا يمكن تمرير
 * أوامر عبر الرابط. والأمر إضافة عمودين فارغين فحسب: لا حذف ولا تعديل بيانات.
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const UPGRADE = `ALTER TABLE finance.accounts
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by BIGINT REFERENCES public.users(id)`;

export async function GET() {
  const session = await requireSession();

  const out: Record<string, unknown> = {
    userId: session.id,
    role: session.role,
  };

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ branch: string | null }>>(
      `SELECT current_setting('neon.branch_id', true) AS branch`,
    );
    out.branch = rows[0]?.branch ?? null;
  } catch {
    out.branch = null;
  }

  try {
    await prisma.$executeRawUnsafe(UPGRADE);
    out.applied = true;
  } catch (error) {
    out.applied = false;
    out.applyError = String((error as { message?: string })?.message ?? error).slice(0, 500);
  }

  try {
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='finance' AND table_name='accounts' ORDER BY column_name`,
    );
    out.columns = cols.map((row) => row.column_name);
    out.closedAtVisible = cols.some((row) => row.column_name === "closed_at");
  } catch (error) {
    out.columnsError = String(error).slice(0, 300);
  }

  return NextResponse.json(out);
}
