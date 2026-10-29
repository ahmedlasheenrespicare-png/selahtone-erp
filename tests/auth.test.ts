import { test } from "node:test";
import assert from "node:assert/strict";
import { authIdentifierHash } from "../src/lib/auth-identifiers";
import { isValidAuthSecret } from "../src/lib/auth-secret";
import { requestHost } from "../src/lib/request-host";
import { changePasswordSchema, emailSchema, loginSchema, newPasswordSchema, passwordByteLength, safeNextPath } from "../src/lib/auth-validation";

test("email is trimmed, normalized, and bounded", () => {
  assert.equal(emailSchema.parse("  USER@Example.COM "), "user@example.com");
  assert.equal(emailSchema.safeParse("not-an-email").success, false);
  assert.equal(emailSchema.safeParse(`${"a".repeat(160)}@example.com`).success, false);
});

test("login accepts an old short password but never accepts more than bcrypt's 72 bytes", () => {
  assert.equal(loginSchema.safeParse({ email: "a@example.com", password: "old", remember: false }).success, true);
  assert.equal(loginSchema.safeParse({ email: "a@example.com", password: "x".repeat(72), remember: true }).success, true);
  assert.equal(loginSchema.safeParse({ email: "a@example.com", password: "x".repeat(73), remember: false }).success, false);
  assert.equal(passwordByteLength("ع".repeat(36)), 72);
  assert.equal(loginSchema.safeParse({ email: "a@example.com", password: "ع".repeat(37), remember: false }).success, false);
});

test("new passwords need at least 12 characters and no more than 72 bytes", () => {
  assert.equal(newPasswordSchema.safeParse("12345678901").success, false);
  assert.equal(newPasswordSchema.safeParse("123456789012").success, true);
  assert.equal(newPasswordSchema.safeParse("ع".repeat(36)).success, true);
  assert.equal(newPasswordSchema.safeParse("ع".repeat(37)).success, false);
  assert.equal(newPasswordSchema.safeParse("🔒".repeat(6)).success, false);
  assert.equal(newPasswordSchema.safeParse("🔒".repeat(12)).success, true);
});

test("changing passwords requires matching confirmation and a new value", () => {
  assert.equal(changePasswordSchema.safeParse({ currentPassword: "old", newPassword: "a-very-long-password", confirmPassword: "different" }).success, false);
  assert.equal(changePasswordSchema.safeParse({ currentPassword: "same-password-123", newPassword: "same-password-123", confirmPassword: "same-password-123" }).success, false);
  assert.equal(changePasswordSchema.safeParse({ currentPassword: "old", newPassword: "a-very-long-password", confirmPassword: "a-very-long-password" }).success, true);
});

test("next preserves local paths and queries", () => {
  assert.equal(safeNextPath("/inventory?category=hearing"), "/inventory?category=hearing");
  assert.equal(safeNextPath("/"), "/");
  assert.equal(safeNextPath(undefined), "/dashboard");
});

test("next rejects external, ambiguous, looping, and API paths", () => {
  for (const input of ["https://evil.example", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/%5cevil.example", "/\n//evil.example", "/a/..//evil.example", "/%2e%2e//evil.example", "/%252f%252fevil.example", "/login", "/change-password", "/api/logout", "/" + "x".repeat(2048)]) {
    assert.equal(safeNextPath(input), "/dashboard", input);
  }
});

test("a missing, short, or previously published example secret is rejected", () => {
  assert.equal(isValidAuthSecret(undefined), false);
  assert.equal(isValidAuthSecret("short"), false);
  assert.equal(isValidAuthSecret("ضع-هنا-قيمة-عشوائية-طويلة-48-بايت"), false);
  assert.equal(isValidAuthSecret("a".repeat(32)), true);
});

test("forwarded hosts are trusted only when they match or are explicitly allowed", () => {
  const headers = new Headers({ host: "site.example", "x-forwarded-host": "evil.example" });
  assert.equal(requestHost(headers, "production"), "site.example");
  assert.equal(requestHost(headers, "production", "evil.example"), "evil.example");
  assert.equal(requestHost(new Headers({ host: "localhost:3000", "x-forwarded-host": "3000-preview.e2b.app" }), "development"), "3000-preview.e2b.app");
  assert.equal(requestHost(new Headers({ host: "localhost:3000", "x-forwarded-host": "3000-preview.e2b.app" }), "production"), "localhost:3000");
});

test("audit and throttle fingerprints are keyed and purpose-separated", () => {
  const secret = "a".repeat(32);
  const audit = authIdentifierHash("user@example.com", "audit", secret);
  assert.match(audit, /^[a-f0-9]{64}$/);
  assert.equal(audit, authIdentifierHash("user@example.com", "audit", secret));
  assert.notEqual(audit, authIdentifierHash("user@example.com", "throttle:login", secret));
  assert.notEqual(audit, authIdentifierHash("user@example.com", "audit", "b".repeat(32)));
});
