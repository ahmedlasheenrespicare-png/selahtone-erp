import assert from "node:assert/strict";
import test from "node:test";
import { chooseCashDestination, type CashAccount, type Collector } from "../prototypes/finance-collection-policy/destination";

const employee: Collector = { id: "3", role: "CS_AGENT", branchId: "1", active: true, mustChangePassword: false };
const manager: Collector = { ...employee, id: "1", role: "MANAGER", branchId: null };
const accountant: Collector = { ...manager, id: "2", role: "ACCOUNTANT" };
const custody: CashAccount = { id: "10", branchId: "1", kind: "CUSTODY", holderId: "3", closed: false };
const vault: CashAccount = { id: "11", branchId: "1", kind: "VAULT", holderId: null, closed: false };

test("employee collection selects only their own open custody in the invoice branch", () => {
  assert.deepEqual(chooseCashDestination(employee, "1", [vault, custody]), { ok: true, accountId: "10", kind: "CUSTODY" });
  for (const accounts of [[], [vault], [{ ...custody, closed: true }], [{ ...custody, branchId: "2" }], [{ ...custody, holderId: "4" }]])
    assert.deepEqual(chooseCashDestination(employee, "1", accounts), { ok: false, reason: "no_custody" });
  assert.deepEqual(chooseCashDestination(employee, "2", [custody]), { ok: false, reason: "forbidden" });
});

test("management uses own open custody first, otherwise the branch vault", () => {
  for (const actor of [manager, accountant]) {
    assert.deepEqual(chooseCashDestination(actor, "1", [custody, vault]), { ok: true, accountId: "11", kind: "VAULT" });
    assert.deepEqual(chooseCashDestination(actor, "1", [vault, { ...custody, id: "12", holderId: actor.id }]), { ok: true, accountId: "12", kind: "CUSTODY" });
    assert.deepEqual(chooseCashDestination(actor, "1", [{ ...vault, closed: true }]), { ok: false, reason: "no_vault" });
    assert.deepEqual(chooseCashDestination(actor, "1", [{ ...vault, branchId: "2" }]), { ok: false, reason: "no_vault" });
  }
});

test("suspended actors, forced password change and ambiguous destination fail closed", () => {
  assert.deepEqual(chooseCashDestination({ ...manager, active: false }, "1", [vault]), { ok: false, reason: "forbidden" });
  assert.deepEqual(chooseCashDestination({ ...employee, mustChangePassword: true }, "1", [custody]), { ok: false, reason: "forbidden" });
  assert.deepEqual(chooseCashDestination(employee, "1", [custody, { ...custody, id: "12" }]), { ok: false, reason: "ambiguous" });
  assert.deepEqual(chooseCashDestination(manager, "1", [vault, { ...vault, id: "12" }]), { ok: false, reason: "ambiguous" });
});
