import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { setDirectoryUserStatus } from "../src/lib/admin-directory-operations";
import { emailSchema } from "../src/lib/auth-validation";

const prisma = new PrismaClient();

async function main() {
  const email = emailSchema.safeParse(process.argv[2]);
  const status = process.argv[3];
  if (!email.success || (status !== "ACTIVE" && status !== "SUSPENDED")) {
    throw new Error("الاستخدام: npm run user:status -- user@example.com ACTIVE|SUSPENDED");
  }
  await setDirectoryUserStatus(prisma, email.data, status, process.env.FINANCE_ENABLED === "true");
  console.log(`✓ حالة المستخدم الآن ${status}، وأُلغيت جميع جلساته.`);
}

main().catch((error) => {
  console.error("✗ فشل تغيير الحالة:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
