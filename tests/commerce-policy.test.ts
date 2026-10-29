import { test } from "node:test";
import assert from "node:assert/strict";
import { canPerformCommerce, type CommerceAction, type CommerceActor } from "../src/lib/commerce-policy";

const manager: CommerceActor = { role: "MANAGER", status: "ACTIVE", mustChangePassword: false, branchId: null };
const accountant: CommerceActor = { role: "ACCOUNTANT", status: "ACTIVE", mustChangePassword: false, branchId: null };
const staff: CommerceActor = { role: "CS_AGENT", status: "ACTIVE", mustChangePassword: false, branchId: 1n };
const actions: CommerceAction[] = ["VIEW_SALE", "CREATE_SALE", "RECORD_COLLECTION", "RETURN_OR_CANCEL", "RECORD_REFUND", "RECEIVE_STOCK", "CONFIGURE_DISCOUNT"];

test("the manager can perform agreed operations; invalid or unknown actions fail closed", () => {
  for (const action of actions) assert.equal(canPerformCommerce(manager, action, 1n, true), true, action);
  assert.equal(canPerformCommerce(manager, "unknown" as CommerceAction, 1n, true), false);
  assert.equal(canPerformCommerce(manager, "CREATE_SALE", null, true), false);
  assert.equal(canPerformCommerce(manager, "CREATE_SALE", 1n, false), false);
  assert.equal(canPerformCommerce(manager, "CONFIGURE_DISCOUNT", null, false), true);
});

test("accountant can view, collect and refund but cannot sell, receive or return", () => {
  for (const action of ["VIEW_SALE", "RECORD_COLLECTION", "RECORD_REFUND"] as const) {
    assert.equal(canPerformCommerce(accountant, action, 1n, true), true);
    assert.equal(canPerformCommerce(accountant, action, 2n, true), true);
  }
  for (const action of ["CREATE_SALE", "RETURN_OR_CANCEL", "RECEIVE_STOCK", "CONFIGURE_DISCOUNT"] as const) {
    assert.equal(canPerformCommerce(accountant, action, 1n, true), false);
  }
});

test("staff sells, receives and collects only in its own branch", () => {
  for (const action of ["VIEW_SALE", "CREATE_SALE", "RECORD_COLLECTION", "RECEIVE_STOCK"] as const) {
    assert.equal(canPerformCommerce(staff, action, 1n, true), true);
    assert.equal(canPerformCommerce(staff, action, 2n, true), false);
  }
  for (const action of ["CREATE_SALE", "RECEIVE_STOCK"] as const) assert.equal(canPerformCommerce(staff, action, 1n, false), false);
  for (const action of ["VIEW_SALE", "RECORD_COLLECTION"] as const) assert.equal(canPerformCommerce(staff, action, 1n, false), true);
  for (const action of ["RETURN_OR_CANCEL", "RECORD_REFUND", "CONFIGURE_DISCOUNT"] as const) {
    assert.equal(canPerformCommerce(staff, action, 1n, true), false);
  }
  assert.equal(canPerformCommerce({ ...staff, branchId: null }, "CREATE_SALE", 1n, true), false);
});

test("inactive and password-reset accounts never get commerce permissions", () => {
  for (const actor of [manager, accountant, staff]) for (const action of actions) {
    assert.equal(canPerformCommerce({ ...actor, status: "SUSPENDED" }, action, 1n, true), false);
    assert.equal(canPerformCommerce({ ...actor, mustChangePassword: true }, action, 1n, true), false);
  }
  assert.equal(canPerformCommerce(null, "CREATE_SALE", 1n, true), false);
});
