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
    const [branches, warehouses, products] = await Promise.all([
      prisma.branch.count(),
      prisma.warehouse.count(),
      prisma.product.count(),
    ]);

    return NextResponse.json({
      status: "ok",
      app: "صلة تون",
      version: "0.1.0",
      db: { connected: true, latencyMs: Date.now() - startedAt },
      counts: { branches, warehouses, products },
      time: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        db: { connected: false },
        message: error instanceof Error ? error.message : "فشل الاتصال بقاعدة البيانات",
      },
      { status: 503 },
    );
  }
}
