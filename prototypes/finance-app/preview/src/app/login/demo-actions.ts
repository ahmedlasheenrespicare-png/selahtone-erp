"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-validation";

const DEMO_ACCOUNTS: Record<string, string> = {
  manager: "manager@example.test",
  accountant: "accountant@example.test",
  staff: "staff@example.test",
};

export async function demoQuickLoginAction(formData: FormData): Promise<void> {
  if (process.env.FINANCE_LAB_ONLY !== "disposable-in-memory") {
    redirect("/login");
  }
  const role = String(formData.get("demoRole") ?? "");
  const email = DEMO_ACCOUNTS[role];
  const next = safeNextPath(formData.get("next"));
  if (!email) redirect("/login");

  const result = await login(email, "DemoOnly-2026!", false);
  if (!result.ok) redirect("/login");
  redirect(result.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next);
}
