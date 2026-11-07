import { PrismaClient } from "@prisma/client";

/**
 * نسخة واحدة من PrismaClient — ضروري في Next.js أثناء التطوير
 * (hot reload ينشئ نسخًا متعددة تُرهق اتصالات قاعدة البيانات).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * بوابة معاينة محلية فقط: عند ضبط `PRISMA_PGLITE_DIR` يُبنى العميل بلا محركات
 * أصلية فوق قاعدة PGlite داخل العملية على المسار المعطى، بدل DATABASE_URL.
 *
 * موجودة لتشغيل نسخة معاينة دون خادم قاعدة بيانات؛ لا تُضبط في الإنتاج.
 * `require` عبر eval حتى لا يحزّمها Next.js افتراضيًا (PGlite حزمة WASM اختيارية).
 */
function createClient(): PrismaClient {
  const pgliteDir = process.env.PRISMA_PGLITE_DIR;
  if (pgliteDir) {
    const req = eval("require") as NodeJS.Require;
    const { PrismaPGlite } = req("pglite-prisma-adapter") as typeof import("pglite-prisma-adapter");
    const { PGlite } = req("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    // وضع المعاينة المحلية يدخل عبر نسخة WASM من العميل: لا ثنائيات محرّك أصلية
    // تُنزَّل في هذه البيئة؛ الإنتاج لا يمر من هنا ولا يتغير.
    const { PrismaClient: WasmPrismaClient } = req("@prisma/client/wasm") as {
      PrismaClient: new (options: { adapter: unknown }) => unknown;
    };
    const adapter = new PrismaPGlite(new PGlite(pgliteDir));
    return new WasmPrismaClient({ adapter }) as unknown as PrismaClient;
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
