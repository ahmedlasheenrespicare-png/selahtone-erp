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
    // النوع الاسمي للمحوّل مختلف عن حزمتين فرعيتين؛ التوافق مُثبت بالتشغيل.
    const adapter = new PrismaPGlite(new PGlite(pgliteDir)) as unknown as ConstructorParameters<typeof PrismaClient>[0] extends { adapter?: infer A } ? A : never;
    return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
