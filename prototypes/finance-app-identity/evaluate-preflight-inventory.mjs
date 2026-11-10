#!/usr/bin/env node
/**
 * TEST ONLY — offline evaluator for the read-only preflight inventory result
 * (docs/finance-identity-remediation-steps-ar.md, appendix A). It NEVER opens
 * a database connection and NEVER runs SQL. It reads ONLY the five aggregate
 * result sets the operator pasted, refuses connection strings / row data, and
 * reconciles the two different COUNT definitions used by the two tools.
 *
 *   node evaluate-preflight-inventory.mjs < inventory.json
 *   node evaluate-preflight-inventory.mjs --file inventory.json
 *
 * The inventory counts EVERY pg_class row in `finance` (tables + sequences +
 * indexes). The app-connection probe counts ONLY relkind IN ('r','p'). So 80
 * is not schema drift; it is a different denominator. But the reviewed step
 * text says "a different count => STOP", so this evaluator deliberately
 * reports STOP_TRIGGERED and never declares phase 2 complete on its own.
 */
import { readFileSync } from "node:fs";

function reject(code) { process.stdout.write(JSON.stringify({ verdict: "INPUT_REJECTED", reason: code }) + "\n"); process.exit(1); }
const [, , flag, filePath] = process.argv;
let raw;
try { raw = flag === "--file" ? readFileSync(filePath, "utf8") : readFileSync(0, "utf8"); }
catch { reject("NO_INPUT"); }
if (/postgresql:\/\/|postgres:\/\/|sslmode|rolpassword|password|dsn|DATABASE_URL|inet_server|current_database/i.test(raw)) reject("CONNECTION_OR_ROW_DATA_IN_INPUT");
if (raw.length > 64_000) reject("INPUT_TOO_LARGE");
let inv;
try { inv = JSON.parse(raw); } catch { reject("INVALID_JSON"); }
if (!inv || typeof inv !== "object" || Array.isArray(inv)) reject("NOT_AN_OBJECT");

const KEYS = ["identity", "memberships", "objects", "finance_totals", "public_totals"];
const extra = Object.keys(inv).filter((k) => !KEYS.includes(k));
if (extra.length) reject("UNEXPECTED_FIELDS");
if (KEYS.some((k) => !(k in inv))) reject("MISSING_FIELDS");
if (!Array.isArray(inv.memberships) || !Array.isArray(inv.objects)) reject("BAD_SHAPE");
if (!inv.identity || !inv.finance_totals || !inv.public_totals) reject("BAD_SHAPE");
// The operator must paste metadata only. A row of business data would carry
// keys like amount/created_at; refuse anything but the reviewed column names.
const OBJ_KEYS = ["object_name", "kind", "owner", "rls_enabled"];
for (const o of inv.objects) {
  if (!o || typeof o !== "object" || Object.keys(o).some((k) => !OBJ_KEYS.includes(k))) reject("ROW_DATA_IN_INPUT");
  if (!/^[a-z_][a-z0-9_]*$/.test(String(o.object_name))) reject("ROW_DATA_IN_INPUT");
  if (!["r", "p", "S", "i", "v", "m"].includes(String(o.kind))) reject("ROW_DATA_IN_INPUT");
}

const byKind = inv.objects.reduce((acc, o) => { acc[o.kind] = (acc[o.kind] ?? 0) + 1; return acc; }, {});
const tables = inv.objects.filter((o) => o.kind === "r" || o.kind === "p").map((o) => o.object_name).sort();
const APP_PROBE_TABLES = [
  "accounts", "audit_events", "cash_counts", "category_audit", "category_requests",
  "category_revisions", "custody_requests", "expense_corrections", "expense_reviews",
  "expenses", "historical_commerce", "movements", "opening_corrections", "payments",
  "reconciliation_cases", "reconciliation_notes", "requests", "settlements",
].sort();
const allOwnedByOwner = inv.objects.every((o) => o.owner === inv.identity.editor_current_user);
const noRlsOnTables = tables.every((n) => inv.objects.find((o) => o.object_name === n)?.rls_enabled === false);
const countReported = inv.finance_totals.finance_object_count;
const countMatchesObjects = countReported === inv.objects.length;
const sameSchemaAsProbe = tables.length === APP_PROBE_TABLES.length && tables.every((n, i) => n === APP_PROBE_TABLES[i]);
const hasLabOnlyTable = inv.objects.some((o) => /request_results/.test(o.object_name));

// Reconciliation: the reviewed phase-2 step expected 18; the draft query
// counts 80. The difference is fully explained, but the STOP rule still fires.
const stopTriggered = countReported !== APP_PROBE_TABLES.length;
const explained = countMatchesObjects && byKind.r === APP_PROBE_TABLES.length &&
  byKind.r + (byKind.S ?? 0) + (byKind.i ?? 0) === countReported && sameSchemaAsProbe;

const verdict = stopTriggered
  ? (explained ? "STOP_TRIGGERED_COUNT_DEFINITION_EXPLAINED" : "STOP_TRIGGERED_UNEXPLAINED_DIFFERENCE")
  : "PHASE2_COUNT_MATCHED";

process.stdout.write(JSON.stringify({
  verdict,
  overall_release_status: "NOT_READY",
  stop_rule: "a different count => STOP; resuming needs an explicit new approval",
  reconciliation: {
    inventory_counts_every_pg_class_row: countReported,
    app_probe_counts_only_relkind_r_p: APP_PROBE_TABLES.length,
    by_kind: byKind,
    tables: tables.length,
    sequences: byKind.S ?? 0,
    indexes: byKind.i ?? 0,
    all_objects_owned_by_current_user: allOwnedByOwner,
    owner: inv.identity.editor_current_user,
    no_rls_on_any_table: noRlsOnTables,
    same_18_table_names_as_app_probe: sameSchemaAsProbe,
    schema_drift: hasLabOnlyTable ? "LAB_TABLE_PRESENT_UNEXPECTED" : "NONE_DETECTED",
    count_matches_object_list: countMatchesObjects,
  },
  membership_note: {
    direct_pg_auth_members_rows: inv.memberships.length,
    app_probe_recursive_role_chain: 11,
    explanation: "The draft reads direct pg_auth_members rows only; the app probe uses WITH RECURSIVE and lists the transitive chain. One direct membership (neon_superuser) is consistent with eleven inherited roles.",
    admin_option_on_direct_membership: inv.memberships.every((m) => m.has_admin_option === false),
    consequence: "Without admin option this role cannot REVOKE neon_superuser from itself; repairing the existing role is not available. A separate application role is required, not optional.",
  },
  grants_scope_for_a_new_role: {
    public_relations: inv.public_totals.public_relation_count,
    finance_tables: byKind.r ?? 0,
    finance_sequences_needing_usage: byKind.S ?? 0,
    finance_indexes_follow_table_owner: byKind.i ?? 0,
    note: "Sequences need USAGE/SELECT/UPDATE or every INSERT fails. Indexes follow their table owner and need no separate grant.",
  },
  limitations: [
    "SQL_EDITOR_ROLE_MAY_DIFFER_FROM_DEPLOYED_APP_ROLE",
    "ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP",
    "NO_PROOF_OF_CASH_MOVEMENT_OR_HUMAN_REVIEW",
    "PHASE2_APPROVAL_PHRASE_NOT_RECEIVED_BEFORE_EXECUTION",
  ],
  note: "Offline metadata-only reconciliation. No connection, no SQL execution, no row data, no deploy approval. Read-only inventory inside BEGIN READ ONLY ... ROLLBACK.",
}, null, 2) + "\n");
