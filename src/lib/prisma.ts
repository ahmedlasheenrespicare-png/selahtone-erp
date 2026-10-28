import { PrismaClient } from "@prisma/client";

/**
 * نسخة واحدة من PrismaClient — ضروري في Next.js أثناء التطوير
 * (hot reload ينشئ نسخًا متعددة تُرهق اتصالات قاعدة البيانات).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
