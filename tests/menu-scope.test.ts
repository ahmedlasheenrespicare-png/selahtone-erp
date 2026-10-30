import assert from "node:assert/strict";
import test from "node:test";

import { isMenuScope, isPathAllowedForScope } from "../src/lib/menu-scope";

test("menu scope accepts the two known values only", () => {
  assert.equal(isMenuScope("FULL"), true);
  assert.equal(isMenuScope("LIMITED"), true);
  assert.equal(isMenuScope("full"), false);
  assert.equal(isMenuScope("SALES"), false);
  assert.equal(isMenuScope(""), false);
});

test("a full scope opens every screen", () => {
  for (const path of ["/dashboard", "/sales", "/inventory", "/admin", "/setup", "/finance", "/finance/accounts"]) {
    assert.equal(isPathAllowedForScope("FULL", path), true, path);
  }
});

test("a limited scope opens the dashboard, sales and expenses only", () => {
  for (const path of ["/dashboard", "/sales", "/sales/new", "/sales/12", "/finance/expenses", "/finance/expenses/new", "/finance/expenses/12"]) {
    assert.equal(isPathAllowedForScope("LIMITED", path), true, path);
  }
  for (const path of [
    "/inventory",
    "/inventory/serials",
    "/inventory/opening",
    "/admin",
    "/setup",
    "/finance",
    "/finance/accounts",
    "/finance/transfers",
    "/finance/counts",
    "/finance/categories",
    "/finance/mine",
  ]) {
    assert.equal(isPathAllowedForScope("LIMITED", path), false, path);
  }
});

test("a limited scope does not open a path that merely starts with the same letters", () => {
  assert.equal(isPathAllowedForScope("LIMITED", "/finance/expenses-archive"), false);
  assert.equal(isPathAllowedForScope("LIMITED", "/salesreport"), false);
  assert.equal(isPathAllowedForScope("LIMITED", "/dashboardx"), false);
});

test("api routes and an empty path stay available for a limited scope", () => {
  assert.equal(isPathAllowedForScope("LIMITED", "/api/health"), true);
  assert.equal(isPathAllowedForScope("LIMITED", "/"), true);
  assert.equal(isPathAllowedForScope("LIMITED", ""), true);
  assert.equal(isPathAllowedForScope("LIMITED", null), true);
});
