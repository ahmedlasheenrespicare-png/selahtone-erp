import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * فحص صحة النظام — يستخدمه UptimeRobot والتحقق بعد النشر.
 * GET /api/health
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await Promise.all([
      prisma.branch.count(),
      prisma.warehouse.count(),
      prisma.product.count(),
    ]);

    return NextResponse.json({
      status: "ok",
      app: "صلة تون",
      version: "0.1.0",
      db: { connected: true, latencyMs: Date.now() - startedAt },
      time: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        db: { connected: false },
        message: "فشل الاتصال بقاعدة البيانات",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
