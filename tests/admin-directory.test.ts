import assert from "node:assert/strict";
import test from "node:test";

import {
  assignableRolesForActor,
  branchInputError,
  canManageBranchStructure,
  canManageTargetUser,
  isAdminRole,
  isIdentifier,
  normalizeBranchCode,
  normalizeInvoicePrefix,
  normalizeName,
  phoneInputError,
  userInputError,
} from "../src/lib/admin-directory";

test("branch code is normalized to uppercase letters and digits", () => {
  assert.equal(normalizeBranchCode(" ism-1 "), "ISM1");
  assert.equal(normalizeInvoicePrefix(" cai/2 "), "CAI2");
  assert.equal(normalizeName("فرع   القاهرة  "), "فرع القاهرة");
});

test("branch input rejects a short code, a long name and a bad invoice prefix", () => {
  const base = { code: "CAI", nameAr: "فرع القاهرة", city: "القاهرة", invoicePrefix: "CAI" };
  assert.equal(branchInputError(base), null);
  assert.match(branchInputError({ ...base, code: "C" }) ?? "", /كود الفرع/);
  assert.match(branchInputError({ ...base, nameAr: "ف" }) ?? "", /اسم الفرع/);
  assert.match(branchInputError({ ...base, city: "x".repeat(81) }) ?? "", /المدينة/);
  assert.match(branchInputError({ ...base, invoicePrefix: "" }) ?? "", /بادئة الفاتورة/);
  // حروف عربية تُزال بالتطبيع فيصبح الكود فارغًا ويُرفض.
  assert.match(branchInputError({ ...base, code: "قا" }) ?? "", /كود الفرع/);
});

test("identifiers accept digits only and reject zero or text", () => {
  assert.equal(isIdentifier("12"), true);
  assert.equal(isIdentifier("0"), false);
  assert.equal(isIdentifier("abc"), false);
  assert.equal(isIdentifier(""), false);
});

test("roles are restricted to the three known codes", () => {
  assert.equal(isAdminRole("MANAGER"), true);
  assert.equal(isAdminRole("ACCOUNTANT"), true);
  assert.equal(isAdminRole("CS_AGENT"), true);
  assert.equal(isAdminRole("ADMIN"), false);
  assert.equal(isAdminRole(""), false);
});

test("a branch agent must belong to a branch, management may stay cross-branch", () => {
  const agent = { fullName: "موظف الفرع", email: "agent@example.com", password: "0123456789abcdef", role: "CS_AGENT", branchId: "3" };
  assert.equal(userInputError(agent, { requirePassword: true }), null);
  assert.match(userInputError({ ...agent, branchId: "" }, { requirePassword: true }) ?? "", /منسوبًا إلى فرع/);
  assert.match(userInputError({ ...agent, branchId: "zero" }, { requirePassword: true }) ?? "", /منسوبًا إلى فرع/);

  const manager = { ...agent, role: "MANAGER", branchId: "" };
  assert.equal(userInputError(manager, { requirePassword: true }), null);
  assert.match(userInputError({ ...manager, branchId: "x" }, { requirePassword: true }) ?? "", /الفرع المختار غير صحيح/);
});

test("user input validates name, email and password policy", () => {
  const base = { fullName: "موظف الفرع", email: "agent@example.com", password: "0123456789abcdef", role: "CS_AGENT", branchId: "3" };
  assert.match(userInputError({ ...base, fullName: "مو" }, { requirePassword: true }) ?? "", /الاسم/);
  assert.match(userInputError({ ...base, email: "not-an-email" }, { requirePassword: true }) ?? "", /بريد/);
  assert.match(userInputError({ ...base, password: "1234" }, { requirePassword: true }) ?? "", /12 حرفًا/);
  assert.match(userInputError({ ...base, role: "OWNER" }, { requirePassword: true }) ?? "", /الدور/);
  // تعديل مستخدم قائم لا يشترط كلمة مرور.
  assert.equal(userInputError({ ...base, password: "" }, { requirePassword: false }), null);
});

test("role hierarchy prevents accountant privilege escalation and validates phone numbers", () => {
  assert.equal(canManageBranchStructure("MANAGER"), true);
  assert.equal(canManageBranchStructure("ACCOUNTANT"), false);
  assert.equal(canManageBranchStructure("CS_AGENT"), false);

  assert.equal(canManageTargetUser("MANAGER", "MANAGER"), true);
  assert.equal(canManageTargetUser("MANAGER", "ACCOUNTANT"), true);
  assert.equal(canManageTargetUser("MANAGER", "CS_AGENT"), true);

  assert.equal(canManageTargetUser("ACCOUNTANT", "MANAGER"), false);
  assert.equal(canManageTargetUser("ACCOUNTANT", "ACCOUNTANT"), false);
  assert.equal(canManageTargetUser("ACCOUNTANT", "CS_AGENT"), true);

  assert.deepEqual(assignableRolesForActor("MANAGER"), ["MANAGER", "ACCOUNTANT", "CS_AGENT"]);
  assert.deepEqual(assignableRolesForActor("ACCOUNTANT"), ["CS_AGENT"]);
  assert.deepEqual(assignableRolesForActor("CS_AGENT"), []);

  assert.equal(phoneInputError(""), null);
  assert.equal(phoneInputError("+20 100 123 4567"), null);
  assert.match(phoneInputError("abc") ?? "", /الهاتف/);
});
