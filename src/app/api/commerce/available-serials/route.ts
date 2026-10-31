import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { inventoryEnabled } from "@/lib/feature-flags";
import { InventoryProblem } from "@/lib/inventory-operations";
import { searchAvailableSaleSerials } from "@/lib/commerce-serial-search";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.mustChangePassword) return NextResponse.json({ message: "سجّل الدخول للبحث عن السيريالات." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (!inventoryEnabled()) return NextResponse.json({ message: "المخزون والمستودعات معطّلة حاليًا في هذا النظام." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  try {
    const result = await searchAvailableSaleSerials(prisma, BigInt(session.id), { warehouseId: request.nextUrl.searchParams.get("warehouseId") ?? "", productId: request.nextUrl.searchParams.get("productId") ?? "", query: request.nextUrl.searchParams.get("q") ?? "" });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof InventoryProblem) return NextResponse.json({ message: error.message }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    console.error("Serial search failed");
    return NextResponse.json({ message: "تعذر تحميل السيريالات. حاول مجددًا." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
