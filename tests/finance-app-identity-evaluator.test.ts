/**
 * TEST ONLY. Synthetic probe results only — no production connection, no real
 * roles, no row data. Verifies the offline evaluator's fail-closed input
 * handling and its verdicts against the acceptance criteria in
 * docs/finance-app-identity-readiness-ar.md §5.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const evaluator = path.join(process.cwd(), "prototypes/finance-app-identity/evaluate-app-connection-probe.mjs");

function evaluate(input: unknown): { code: number; out: string; parsed: any } {
  const r = spawnSync(process.execPath, [evaluator], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
    timeout: 30_000,
  });
  let parsed: any = null;
  try { parsed = JSON.parse(r.stdout.trim()); } catch { /* raw stdout kept */ }
  return { code: r.status ?? 1, out: r.stdout, parsed };
}

function evaluatePair(first: unknown, second: unknown, omitSecondPath = false): { code: number; out: string; parsed: any } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "finance-probe-pair-"));
  try {
    const a = path.join(dir, "first.json"), b = path.join(dir, "second.json");
    writeFileSync(a, typeof first === "string" ? first : JSON.stringify(first));
    if (second !== undefined) writeFileSync(b, typeof second === "string" ? second : JSON.stringify(second));
    const args = [evaluator, "--file", a, "--compare", omitSecondPath ? "" : b];
    const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" }, timeout: 30_000 });
    let parsed: any = null;
    try { parsed = JSON.parse(r.stdout.trim()); } catch { /* raw stdout kept */ }
    return { code: r.status ?? 1, out: r.stdout, parsed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function probe(overrides: Record<string, unknown> = {}) {
  return {
    probe_scope: "APP_CONNECTION_ONLY",
    probe_version: "1.1",
    read_only_transaction: true,
    current_user: "app_scoped_test",
    session_user: "app_scoped_test",
    role_flags: { superuser: false, inherit: true, create_role: false, create_db: false, can_login: true, replication: false, bypass_rls: false },
    inherited_roles: ["app_group_test"],
    inherits_write_all_data: false,
    inherits_read_all_data: false,
    can_create_schema: false,
    finance_schema_present: true,
    finance_schema_owned_by_current_user: false,
    can_create_in_finance: false,
    finance_object_count: 1,
    finance_objects: [{
      table_name: "movements_test_only", owned_by_current_user: false,
      can_select: true, can_insert: true, can_update: true,
      can_delete: false, can_truncate: false, rls_active: true,
    }],
    limitations: ["ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP"],
    ...overrides,
  };
}

test("a broad inherited write role is a confirmed identity gap", () => {
  const r = evaluate(probe({
    inherits_write_all_data: true,
    inherited_roles: ["pg_write_all_data"],
    finance_objects: [{ ...probe().finance_objects[0], can_delete: true, rls_active: false }],
  }));
  assert.equal(r.code, 0);
  assert.equal(r.parsed.verdict, "IDENTITY_GAP_CONFIRMED");
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
  assert(r.parsed.criteria.find((c: any) => c.id === "C1_no_broad_role").status === "FAIL");
  assert(r.parsed.criteria.find((c: any) => c.id === "C2_table_privileges").status === "FAIL");
  assert.match(r.out, /pg_write_all_data/, "role names are metadata, safe to report");
});

test("a scoped role passes the measurable fields but never yields READY", () => {
  const r = evaluate(probe());
  assert.equal(r.code, 0);
  assert.equal(r.parsed.verdict, "IDENTITY_FIELDS_PASS_EXTERNAL_STEPS_PENDING");
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C1_no_broad_role").status, "PASS");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C2_table_privileges").status, "PASS");
  for (const id of ["C3_stable_identity", "C4_real_role_guard_retest", "C5_review_and_approvals"]) {
    assert.match(r.parsed.criteria.find((c: any) => c.id === id).status, /REQUIRES/);
  }
});

test("an absent finance schema is INCOMPLETE, never a pass", () => {
  const r = evaluate(probe({
    finance_schema_present: false, finance_schema_owned_by_current_user: null,
    can_create_in_finance: null, finance_object_count: 0, finance_objects: [],
  }));
  assert.equal(r.parsed.verdict, "INCOMPLETE_SCHEMA_OR_DECISION");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C1_no_broad_role").status, "INCOMPLETE");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C2_table_privileges").status, "NOT_APPLICABLE");
});

test("input containing a connection string or extra field is refused without echo", () => {
  const secret = "postgresql://user:SENTINEL_SECRET@db.example.test/neondb?sslmode=require";
  const withUrl = evaluate(probe({ extra_note: secret }));
  assert.equal(withUrl.code, 1);
  assert.equal(withUrl.parsed.verdict, "INPUT_REJECTED");
  // The secret scan runs BEFORE the field check, deliberately fail-closed.
  assert.equal(withUrl.parsed.reason, "CONNECTION_OR_ROW_DATA_IN_INPUT");
  assert(!withUrl.out.includes("SENTINEL_SECRET"));
  const extraField = evaluate(probe({ harmless_note: "x" }));
  assert.equal(extraField.parsed.reason, "UNEXPECTED_FIELDS");
  const rawUrl = evaluate(secret);
  assert.equal(rawUrl.code, 1);
  assert(!rawUrl.out.includes("SENTINEL_SECRET"));
  const missing = evaluate({ probe_scope: "APP_CONNECTION_ONLY" });
  assert.equal(missing.parsed.reason, "MISSING_FIELDS");
  const notReadOnly = evaluate(probe({ read_only_transaction: false }));
  assert.equal(notReadOnly.parsed.reason, "NOT_READ_ONLY");
  const oldVersion = evaluate(probe({ probe_version: "1.0" }));
  assert.equal(oldVersion.parsed.reason, "WRONG_PROBE_VERSION");
});

test("row-data-shaped finance objects are refused", () => {
  const r = evaluate(probe({
    finance_objects: [{ ...probe().finance_objects[0], amount: "9182.31" }],
  }));
  assert.equal(r.code, 1);
  assert.equal(r.parsed.reason, "BAD_FINANCE_OBJECT");
  assert(!r.out.includes("9182.31"));
});

test("BYPASSRLS alone fails the table-privilege criterion even after a REVOKE", () => {
  const r = evaluate(probe({ role_flags: { ...probe().role_flags, bypass_rls: true },
    finance_objects: [{ ...probe().finance_objects[0], can_delete: false, can_truncate: false, owned_by_current_user: false, rls_active: true }] }));
  assert.equal(r.parsed.verdict, "IDENTITY_GAP_CONFIRMED");
  const c2 = r.parsed.criteria.find((c: any) => c.id === "C2_table_privileges");
  assert.equal(c2.status, "FAIL");
  assert.match(c2.detail, /bypass_rls/);
});

test("the reported 2026-11-05 app-connection shape is pinned to IDENTITY_GAP_CONFIRMED", () => {
  // Structural replica of the operator's real report: metadata only, no rows,
  // no connection values. Keeps the verdict reproducible in CI.
  const tables = ["accounts","audit_events","cash_counts","category_audit","category_requests","category_revisions","custody_requests","expense_corrections","expense_reviews","expenses","historical_commerce","movements","opening_corrections","payments","reconciliation_cases","reconciliation_notes","requests","settlements"];
  const r = evaluate(probe({
    current_user: "neondb_owner", session_user: "neondb_owner",
    role_flags: { ...probe().role_flags, bypass_rls: true, create_role: true, create_db: true, replication: true },
    inherited_roles: ["neon_superuser", "pg_read_all_data", "pg_write_all_data"],
    inherits_write_all_data: true, inherits_read_all_data: true,
    can_create_schema: true, can_create_in_finance: true,
    finance_schema_present: true, finance_schema_owned_by_current_user: true,
    finance_object_count: 18,
    finance_objects: tables.map((table_name) => ({ table_name, owned_by_current_user: true, can_select: true, can_insert: true, can_update: true, can_delete: true, can_truncate: true, rls_active: false })),
  }));
  assert.equal(r.parsed.verdict, "IDENTITY_GAP_CONFIRMED");
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C1_no_broad_role").status, "FAIL");
  assert.match(r.parsed.criteria.find((c: any) => c.id === "C1_no_broad_role").detail, /bypass_rls/);
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C2_table_privileges").status, "FAIL");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C3_stable_identity").status, "REQUIRES_SECOND_CONNECTION");
});


test("two independent connections with an identical aggregate close C3, never readiness", () => {
  const r = evaluatePair(probe(), probe());
  assert.equal(r.code, 0);
  const c3 = r.parsed.criteria.find((c: any) => c.id === "C3_stable_identity");
  assert.equal(c3.status, "PASS");
  assert.equal(r.parsed.comparison.mode, "TWO_CONNECTIONS");
  assert.deepEqual(r.parsed.comparison.differing_identity_fields, []);
  assert.equal(r.parsed.comparison.whole_aggregate_identical, true);
  assert.equal(r.parsed.comparison.first_canonical_sha256, r.parsed.comparison.second_canonical_sha256);
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
  assert.match(r.parsed.criteria.find((c: any) => c.id === "C4_real_role_guard_retest").status, /REQUIRES/);
  assert.match(r.parsed.criteria.find((c: any) => c.id === "C5_review_and_approvals").status, /REQUIRES/);
  assert.match(r.parsed.note, /does NOT prove the deployed app identity/);
});

test("a differing current_user between connections fails C3 without echoing the value", () => {
  const r = evaluatePair(probe(), probe({ current_user: "SENTINEL_OTHER_ROLE", session_user: "SENTINEL_OTHER_ROLE" }));
  assert.equal(r.code, 0);
  const c3 = r.parsed.criteria.find((c: any) => c.id === "C3_stable_identity");
  assert.equal(c3.status, "FAIL");
  assert.match(c3.detail, /current_user/);
  assert(!r.out.includes("SENTINEL_OTHER_ROLE"));
  assert(r.parsed.comparison.differing_identity_fields.includes("current_user"));
  assert.equal(r.parsed.comparison.whole_aggregate_identical, false);
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
});

test("compare mode stays fail-closed on the second input and on a missing path", () => {
  const secret = "postgresql://user:SENTINEL_SECRET@db.example.test/neondb?sslmode=require";
  const leaked = evaluatePair(probe(), probe({ harmless_note: secret }));
  assert.equal(leaked.code, 1);
  assert.equal(leaked.parsed.verdict, "INPUT_REJECTED");
  assert(!leaked.out.includes("SENTINEL_SECRET"));
  const missing = evaluatePair(probe(), undefined, true);
  assert.equal(missing.code, 1);
  assert.equal(missing.parsed.verdict, "INPUT_REJECTED");
  assert(!missing.out.includes("SENTINEL_SECRET"));
});

test("the real reported shape on two connections is still IDENTITY_GAP_CONFIRMED", () => {
  const tables = ["accounts","audit_events","cash_counts","category_audit","category_requests","category_revisions","custody_requests","expense_corrections","expense_reviews","expenses","historical_commerce","movements","opening_corrections","payments","reconciliation_cases","reconciliation_notes","requests","settlements"];
  const real = probe({
    current_user: "neondb_owner", session_user: "neondb_owner",
    role_flags: { ...probe().role_flags, bypass_rls: true, create_role: true, create_db: true, replication: true },
    inherited_roles: ["neon_superuser", "pg_read_all_data", "pg_write_all_data"],
    inherits_write_all_data: true, inherits_read_all_data: true,
    can_create_schema: true, can_create_in_finance: true,
    finance_schema_present: true, finance_schema_owned_by_current_user: true,
    finance_object_count: 18,
    finance_objects: tables.map((table_name) => ({ table_name, owned_by_current_user: true, can_select: true, can_insert: true, can_update: true, can_delete: true, can_truncate: true, rls_active: false })),
  });
  const r = evaluatePair(real, real);
  assert.equal(r.parsed.verdict, "IDENTITY_GAP_CONFIRMED");
  assert.equal(r.parsed.overall_release_status, "NOT_READY");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C1_no_broad_role").status, "FAIL");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C2_table_privileges").status, "FAIL");
  assert.equal(r.parsed.criteria.find((c: any) => c.id === "C3_stable_identity").status, "PASS");
});
