/**
 * مسار تشخيص مؤقت — يُحذف بعد أن يُحدَّد سبب تعطّل لوحة القيادة.
 *
 * يعرض ثلاث حقائق لا تظهر في الواجهة:
 *   ١. بأي قاعدة يتصل التطبيق فعلًا (اسمها وعنوانها).
 *   ٢. هل يرى عمود finance.accounts.closed_at من نفس الاتصال.
 *   ٣. رسالة الخطأ الحقيقية من loadCashSummary، وهي ما تخفيه الصفحة خلف «حدث خطأ مؤقت».
 *
 * مقصور على المدير، ولا يكشف كلمة سر ولا رابط اتصال.
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadCashSummary } from "@/lib/finance/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (session.role !== "MANAGER") return new NextResponse("not found", { status: 404 });

  const out: Record<string, unknown> = {
    userId: session.id,
    role: session.role,
    branchId: session.branchId ?? null,
  };

  try {
    const who = await prisma.$queryRawUnsafe<
      Array<{ db: string; host: string; usr: string }>
    >(`SELECT current_database() AS db, inet_server_addr()::text AS host, current_user AS usr`);
    out.connection = who[0] ?? null;
  } catch (error) {
    out.connectionError = String(error).slice(0, 400);
  }

  // بصمة النسخة: تميّز كل قاعدة عن أختها، فيُعرف هل المحرّر والتطبيق على قاعدة واحدة.
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT system_identifier::text AS id FROM pg_control_system()`,
    );
    out.systemIdentifier = rows[0]?.id ?? null;
  } catch (error) {
    out.systemIdentifierError = String(error).slice(0, 200);
  }

  // مضيف الاتصال بلا اسم مستخدم ولا كلمة سر: يكشف أي قاعدة يقرأ التطبيق فعلًا.
  const hostOf = (value?: string): string | null => {
    if (!value) return null;
    const withoutCredentials = value.replace(/^postgres(ql)?:\/\/[^@]*@/, "");
    return withoutCredentials.split("/")[0] || null;
  };
  out.datasourceHost = hostOf(process.env.DATABASE_URL);
  out.directHost = hostOf(process.env.DIRECT_URL);
  out.financeEnabled = process.env.FINANCE_ENABLED ?? null;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM finance.accounts WHERE closed_at IS NULL`,
    );
    out.closedAtVisible = true;
    out.openCustodyAccounts = rows[0]?.n ?? null;
  } catch (error) {
    out.closedAtVisible = false;
    out.closedAtError = String((error as { message?: string })?.message ?? error).slice(0, 400);
  }

  try {
    const summary = await loadCashSummary(session);
    out.cashSummary = summary ?? null;
  } catch (error) {
    const e = error as { name?: string; code?: string; message?: string; meta?: unknown };
    out.cashSummaryError = {
      name: e?.name ?? null,
      code: e?.code ?? null,
      message: String(e?.message ?? error).slice(0, 700),
      meta: e?.meta ? String(JSON.stringify(e.meta)).slice(0, 400) : null,
    };
  }

  return NextResponse.json(out);
}
