/**
 * TEST ONLY — synthetic metadata aggregates only. No connection, no production
 * read, no row data, no secrets. Guards the offline evaluator for the
 * supplementary `public` inventory: exact grant scope, schema-qualified name
 * collision, fail-closed input handling, and a permanently NOT_READY verdict.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const evaluator = path.join(process.cwd(), "prototypes/finance-app-identity/evaluate-public-inventory.mjs");
function evaluate(input: unknown): { code: number; out: string; parsed: any } {
  const r = spawnSync(process.execPath, [evaluator], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8", env: { ...process.env, NODE_ENV: "test" }, timeout: 30_000,
  });
  let parsed: any = null;
  try { parsed = JSON.parse(r.stdout.trim()); } catch { /* raw kept */ }
  return { code: r.status ?? 1, out: r.stdout, parsed };
}
const SEQS = ["branches","commerce_collections","commerce_refunds","commerce_return_lines","commerce_return_serials","commerce_returns","commerce_sale_line_serials","commerce_sale_lines","commerce_sales","commerce_settings_changes","expense_categories","expenses","inventory_openings","inventory_product_creations","inventory_receipts","inventory_serials","invoice_items","invoice_taxes","invoices","journal_entries","login_attempts","products","sales_catalog_audit","sales_item_categories","sales_item_fields","sales_item_types","stock_levels","tax_rates","users","warehouses"];
const TABLES = ["auth_sessions","branches","commerce_collections","commerce_refunds","commerce_return_lines","commerce_return_serials","commerce_returns","commerce_sale_line_serials","commerce_sale_lines","commerce_sales","commerce_settings","commerce_settings_changes","expense_categories","expenses","inventory_openings","inventory_product_creations","inventory_receipts","inventory_serials","invoice_items","invoice_taxes","invoices","journal_entries","login_attempts","login_throttles","products","sales_catalog_audit","sales_item_categories","sales_item_fields","sales_item_types","stock_levels","tax_rates","users","warehouses"];
function inventory(overrides: Record<string, unknown> = {}) {
  const objects = [
    ...SEQS.map((n) => ({ object_name: `${n}_id_seq`, kind: "S", owner: "neondb_owner", rls_enabled: false, rls_forced: false })),
    ...TABLES.map((n) => ({ object_name: n, kind: "r", owner: "neondb_owner", rls_enabled: false, rls_forced: false })),
  ];
  return {
    summary: [{ kind: "S", owner: "neondb_owner", object_count: 30 }, { kind: "r", owner: "neondb_owner", object_count: 33 }],
    objects,
    sequences: SEQS.map((n) => ({ sequence_name: `${n}_id_seq`, owner: "neondb_owner" })),
    routines: [{ public_function_count: 0, public_user_trigger_count: 0 }],
    ...overrides,
  };
}

test("the 63 public objects reconcile and define the exact grant scope", () => {
  const r = evaluate(inventory());
  assert.equal(r.code, 0);
  assert.equal(r.parsed.verdict, "PUBLIC_INVENTORY_CONFIRMED_GRANT_SCOPE_KNOWN");
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
  assert.deepEqual(r.parsed.reconciliation.by_kind, { S: 30, r: 33 });
  assert.equal(r.parsed.reconciliation.all_owned_by_one_role, true);
  assert.equal(r.parsed.reconciliation.rls_enabled_or_forced_anywhere, false);
  assert.equal(r.parsed.reconciliation.views_or_matviews, 0);
  assert.equal(r.parsed.reconciliation.public_function_count, 0);
  assert.equal(r.parsed.reconciliation.public_user_trigger_count, 0);
  assert.deepEqual(r.parsed.grants_scope_for_new_app_role.schema_usage, ["public", "finance"]);
  assert.equal(r.parsed.grants_scope_for_new_app_role.public_tables_needing_dml, 33);
  assert.equal(r.parsed.grants_scope_for_new_app_role.public_sequences_needing_usage, 30);
});

test("the expenses name collision and legacy public tables are flagged", () => {
  const r = evaluate(inventory());
  const w = r.parsed.warnings.join(" | ");
  assert.match(w, /NAME_COLLISION_ACROSS_SCHEMAS:expenses/);
  assert.match(w, /LEGACY_PUBLIC_TABLES_PRESENT:expense_categories,journal_entries/);
  assert.match(w, /LEGACY_ROWS_NOT_VERIFIED/);
  assert.match(w, /NO_RLS_ANYWHERE_IN_PUBLIC/);
  assert.match(r.parsed.grants_scope_for_new_app_role.note, /schema-qualified/);
  assert.deepEqual(r.parsed.reconciliation.tables_without_own_sequence, ["auth_sessions", "commerce_settings", "login_throttles"]);
});

test("an inconsistent count or a mismatched sequence list stops the phase", () => {
  const badCount = inventory();
  badCount.summary = [{ kind: "S", owner: "neondb_owner", object_count: 30 }, { kind: "r", owner: "neondb_owner", object_count: 32 }];
  assert.equal(evaluate(badCount).parsed.verdict, "PUBLIC_INVENTORY_INCONSISTENT_STOP");
  const badSeq = inventory();
  badSeq.sequences = badSeq.sequences.slice(1);
  assert.equal(evaluate(badSeq).parsed.reconciliation.sequence_list_matches_objects, false);
  assert.equal(evaluate(badSeq).parsed.verdict, "PUBLIC_INVENTORY_INCONSISTENT_STOP");
});

test("connection strings, row-shaped objects and extra fields are refused without echo", () => {
  const secret = "postgresql://user:SENTINEL_SECRET@db.example.test/neondb?sslmode=require";
  const withUrl = evaluate(inventory({ harmless_note: secret }));
  assert.equal(withUrl.code, 1);
  assert.equal(withUrl.parsed.verdict, "INPUT_REJECTED");
  assert.equal(withUrl.parsed.reason, "CONNECTION_OR_ROW_DATA_IN_INPUT");
  assert(!withUrl.out.includes("SENTINEL_SECRET"));
  assert.equal(evaluate(inventory({ harmless_note: "x" })).parsed.reason, "UNEXPECTED_FIELDS");
  const inv = inventory();
  inv.objects = [{ object_name: "users", kind: "r", owner: "neondb_owner", rls_enabled: false, rls_forced: false, amount: "9182.31" } as unknown as typeof inv.objects[number]];
  const row = evaluate(inv);
  assert.equal(row.parsed.reason, "ROW_DATA_IN_INPUT");
  assert(!row.out.includes("9182.31"));
  assert.equal(evaluate({ summary: [] }).parsed.reason, "MISSING_FIELDS");
});

test("the evaluator never authorizes roles, ownership transfer, or deployment", () => {
  const r = evaluate(inventory());
  assert(r.parsed.limitations.includes("DOES_NOT_AUTHORIZE_ROLE_CREATION_OR_OWNERSHIP_TRANSFER"));
  assert(r.parsed.limitations.includes("DOES_NOT_AUTHORIZE_DATABASE_URL_CHANGE_OR_DEPLOY"));
  assert(r.parsed.warnings.includes("PHASE_APPROVAL_PHRASE_NOT_RECEIVED_BEFORE_EXECUTION"));
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
});
