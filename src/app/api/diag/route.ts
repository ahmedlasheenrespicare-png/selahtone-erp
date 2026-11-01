/**
 * مسار تشخيص مؤقت — يُحذف بعد أن يُحدَّد سبب تعطّل لوحة القيادة.
 *
 * مفتوح لكل جلسة صالحة (لا للمدير وحده) لأن الحساب المستعمل تبيّن أنه ليس
 * مديرًا. يجرب قراءتي اللوحة معًا: ملخّص الشركة (loadCashSummary) وعهدة
 * الموظف (loadEmployeeCash)، فيظهر الخطأ أيًّا كان الدور.
 *
 * لا يكشف كلمة سر ولا رابط اتصال: من الرابط يُطبع المضيف وحده.
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadCashSummary, loadEmployeeCash } from "@/lib/finance/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();

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

  // بصمة النسخة: تميّز كل قاعدة عن أختها فيُعرف هل المحرّر والتطبيق على قاعدة واحدة.
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

  // هل يرى التطبيق عمود الإقفال من اتصاله هو، لا من المحرّر.
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

  // ماذا يرى التطبيق في الكتالوج نفسه: فقد يكون العمود مثبَّتًا والمشكلة في الرؤية.
  try {
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='finance' AND table_name='accounts' ORDER BY column_name`,
    );
    out.accountsColumnsAsSeenByApp = cols.map((row) => row.column_name);
  } catch (error) {
    out.accountsColumnsError = String(error).slice(0, 300);
  }

  // المخططات المرئية للاتصال: قد يُحلّ finance إلى غير ما نظن.
  try {
    const sp = await prisma.$queryRawUnsafe<Array<{ sp: string; schemas: unknown }>>(
      `SELECT current_setting('search_path') AS sp, current_schemas(true) AS schemas`,
    );
    out.searchPath = sp[0] ?? null;
  } catch (error) {
    out.searchPathError = String(error).slice(0, 200);
  }

  // كل مخطط فيه جدول accounts: يكشف التكرار إن وُجد جدول آخر يحجبه.
  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ table_schema: string; cols: number }>>(
      `SELECT table_schema, count(*)::int AS cols FROM information_schema.columns WHERE table_name='accounts' GROUP BY table_schema ORDER BY table_schema`,
    );
    out.accountsTablesBySchema = tables;
  } catch (error) {
    out.accountsTablesError = String(error).slice(0, 300);
  }

  // معرّف الفرع عند Neon إن كان متاحًا.
  try {
    const branch = await prisma.$queryRawUnsafe<Array<{ branch: string | null }>>(
      `SELECT current_setting('neon.branch_id', true) AS branch`,
    );
    out.neonBranch = branch[0]?.branch ?? null;
  } catch (error) {
    out.neonBranchError = String(error).slice(0, 200);
  }

  // قراءتا اللوحة: أيّهما يسلكها الدور يظهر خطؤه الحقيقي.
  try {
    out.cashSummary = (await loadCashSummary(session)) ?? null;
  } catch (error) {
    const e = error as { name?: string; code?: string; message?: string; meta?: unknown };
    out.cashSummaryError = {
      name: e?.name ?? null,
      code: e?.code ?? null,
      message: String(e?.message ?? error).slice(0, 700),
      meta: e?.meta ? String(JSON.stringify(e.meta)).slice(0, 400) : null,
    };
  }

  try {
    out.employeeCash = (await loadEmployeeCash(session)) ?? null;
  } catch (error) {
    const e = error as { name?: string; code?: string; message?: string; meta?: unknown };
    out.employeeCashError = {
      name: e?.name ?? null,
      code: e?.code ?? null,
      message: String(e?.message ?? error).slice(0, 700),
      meta: e?.meta ? String(JSON.stringify(e.meta)).slice(0, 400) : null,
    };
  }

  return NextResponse.json(out);
}
