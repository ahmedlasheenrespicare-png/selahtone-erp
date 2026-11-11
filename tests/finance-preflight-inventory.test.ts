/**
 * TEST ONLY — synthetic metadata aggregates only. No database connection, no
 * production read, no row data, no secrets. Verifies the offline preflight
 * inventory evaluator: it reconciles the two COUNT definitions, fires the
 * STOP rule, and refuses connection strings / row-shaped input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const evaluator = path.join(process.cwd(), "prototypes/finance-app-identity/evaluate-preflight-inventory.mjs");

function evaluate(input: unknown): { code: number; out: string; parsed: any } {
  const r = spawnSync(process.execPath, [evaluator], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
    timeout: 30_000,
  });
  let parsed: any = null;
  try { parsed = JSON.parse(r.stdout.trim()); } catch { /* raw kept */ }
  return { code: r.status ?? 1, out: r.stdout, parsed };
}

const TABLES = [
  "accounts", "audit_events", "cash_counts", "category_audit", "category_requests",
  "category_revisions", "custody_requests", "expense_corrections", "expense_reviews",
  "expenses", "historical_commerce", "movements", "opening_corrections", "payments",
  "reconciliation_cases", "reconciliation_notes", "requests", "settlements",
];

/** Synthetic rebuild of the operator's metadata lists: 18 tables, 15 sequences, 47 indexes. */
function inventory(overrides: Record<string, unknown> = {}) {
  const objects: Record<string, unknown>[] = [];
  for (const t of TABLES) objects.push({ object_name: t, kind: "r", owner: "neondb_owner", rls_enabled: false });
  for (let i = 0; i < 15; i++) objects.push({ object_name: `seq_${i}_id_seq`, kind: "S", owner: "neondb_owner", rls_enabled: false });
  for (let i = 0; i < 47; i++) objects.push({ object_name: `idx_${i}`, kind: "i", owner: "neondb_owner", rls_enabled: false });
  return {
    identity: { editor_current_user: "neondb_owner", editor_session_user: "neondb_owner", editor_superuser: false, editor_bypass_rls: true, editor_create_db: true, editor_create_role: true },
    memberships: [{ inherited_role: "neon_superuser", has_admin_option: false }],
    objects,
    finance_totals: { finance_object_count: 80, owned_by_neondb_owner: 80, rls_enabled_objects: 0 },
    public_totals: { public_relation_count: 63 },
    ...overrides,
  };
}

test("an 80-object inventory is explained by 18 tables + 15 sequences + 47 indexes", () => {
  const r = evaluate(inventory());
  assert.equal(r.code, 0);
  assert.equal(r.parsed.verdict, "STOP_TRIGGERED_COUNT_DEFINITION_EXPLAINED");
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
  assert.deepEqual(r.parsed.reconciliation.by_kind, { r: 18, S: 15, i: 47 });
  assert.equal(r.parsed.reconciliation.same_18_table_names_as_app_probe, true);
  assert.equal(r.parsed.reconciliation.schema_drift, "NONE_DETECTED");
  assert.equal(r.parsed.reconciliation.all_objects_owned_by_current_user, true);
  assert.equal(r.parsed.reconciliation.no_rls_on_any_table, true);
  assert.match(r.parsed.stop_rule, /explicit new approval/);
});

test("a genuinely unexplained difference never gets excused", () => {
  const inv = inventory();
  inv.finance_totals = { ...inv.finance_totals, finance_object_count: 79 };
  const r = evaluate(inv);
  assert.equal(r.parsed.verdict, "STOP_TRIGGERED_UNEXPLAINED_DIFFERENCE");
  assert.equal(r.parsed.reconciliation.count_matches_object_list, false);
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
});

test("a lab-only table is reported as unexpected schema drift", () => {
  const inv = inventory();
  inv.objects = [...inv.objects, { object_name: "request_results", kind: "r", owner: "neondb_owner", rls_enabled: false }];
  inv.finance_totals = { ...inv.finance_totals, finance_object_count: 81 };
  const r = evaluate(inv);
  assert.equal(r.parsed.reconciliation.schema_drift, "LAB_TABLE_PRESENT_UNEXPECTED");
  assert.equal(r.parsed.verdict, "STOP_TRIGGERED_UNEXPLAINED_DIFFERENCE");
});

test("the admin-option finding makes a separate app role mandatory", () => {
  const r = evaluate(inventory());
  assert.equal(r.parsed.membership_note.admin_option_on_direct_membership, true);
  assert.equal(r.parsed.membership_note.direct_pg_auth_members_rows, 1);
  assert.match(r.parsed.membership_note.explanation, /WITH RECURSIVE/);
  assert.match(r.parsed.membership_note.consequence, /separate application role is required/);
  assert.equal(r.parsed.grants_scope_for_a_new_role.public_relations, 63);
  assert.equal(r.parsed.grants_scope_for_a_new_role.finance_sequences_needing_usage, 15);
  assert.match(r.parsed.grants_scope_for_a_new_role.note, /USAGE/);
});

test("connection strings, row-shaped objects and extra fields are refused without echo", () => {
  const secret = "postgresql://user:SENTINEL_SECRET@db.example.test/neondb?sslmode=require";
  const withUrl = evaluate(inventory({ harmless_note: secret }));
  assert.equal(withUrl.code, 1);
  assert.equal(withUrl.parsed.verdict, "INPUT_REJECTED");
  assert(!withUrl.out.includes("SENTINEL_SECRET"));
  assert.equal(withUrl.parsed.reason, "CONNECTION_OR_ROW_DATA_IN_INPUT");
  const extra = evaluate(inventory({ harmless_note: "x" }));
  assert.equal(extra.parsed.reason, "UNEXPECTED_FIELDS");
  const inv = inventory();
  inv.objects = [{ object_name: "movements", kind: "r", owner: "neondb_owner", rls_enabled: false, amount: "9182.31" }];
  const row = evaluate(inv);
  assert.equal(row.parsed.reason, "ROW_DATA_IN_INPUT");
  assert(!row.out.includes("9182.31"));
  assert.equal(evaluate({ identity: {} }).parsed.reason, "MISSING_FIELDS");
});

test("--file mode works and the phase-2 approval phrase is listed as not received", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "finance-inventory-"));
  try {
    const f = path.join(dir, "inventory.json");
    writeFileSync(f, JSON.stringify(inventory()));
    const r = spawnSync(process.execPath, [evaluator, "--file", f], { encoding: "utf8", timeout: 30_000 });
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout.trim());
    assert.equal(parsed.verdict, "STOP_TRIGGERED_COUNT_DEFINITION_EXPLAINED");
    assert(parsed.limitations.includes("PHASE2_APPROVAL_PHRASE_NOT_RECEIVED_BEFORE_EXECUTION"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
