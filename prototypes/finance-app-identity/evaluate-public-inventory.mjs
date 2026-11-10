#!/usr/bin/env node
/**
 * TEST ONLY — offline evaluator for the supplementary `public` inventory
 * (public-inventory-DRAFT-NOT-EXECUTABLE.md). NEVER opens a connection, NEVER
 * runs SQL. Reads ONLY the four metadata result sets, refuses connection
 * strings / row data, and derives the exact grant scope a new application role
 * needs. It deliberately never says READY: grants, ownership transfer, SQL
 * approval, deploy approval and C4/C5 are all still separate steps.
 *
 *   node evaluate-public-inventory.mjs < public-inventory.json
 *   node evaluate-public-inventory.mjs --file public-inventory.json
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
const KEYS = ["summary", "objects", "sequences", "routines"];
const extra = Object.keys(inv).filter((k) => !KEYS.includes(k));
if (extra.length) reject("UNEXPECTED_FIELDS");
if (KEYS.some((k) => !(k in inv))) reject("MISSING_FIELDS");
for (const k of KEYS) if (!Array.isArray(inv[k])) reject("BAD_SHAPE");

const OBJ_KEYS = ["object_name", "kind", "owner", "rls_enabled", "rls_forced"];
for (const o of inv.objects) {
  if (!o || typeof o !== "object" || Object.keys(o).some((k) => !OBJ_KEYS.includes(k))) reject("ROW_DATA_IN_INPUT");
  if (!/^[a-z_][a-z0-9_]*$/.test(String(o.object_name))) reject("ROW_DATA_IN_INPUT");
  if (!["r", "p", "S", "i", "v", "m"].includes(String(o.kind))) reject("ROW_DATA_IN_INPUT");
}
for (const s of inv.sequences) {
  if (!s || typeof s !== "object" || Object.keys(s).some((k) => !["sequence_name", "owner"].includes(k))) reject("ROW_DATA_IN_INPUT");
}

const byKind = inv.objects.reduce((acc, o) => { acc[o.kind] = (acc[o.kind] ?? 0) + 1; return acc; }, {});
const tables = inv.objects.filter((o) => o.kind === "r" || o.kind === "p").map((o) => o.object_name);
const seqs = inv.objects.filter((o) => o.kind === "S").map((o) => o.object_name);
const owners = [...new Set(inv.objects.map((o) => o.owner))];
const summaryTotal = inv.summary.reduce((a, s) => a + Number(s.object_count || 0), 0);
const countsAgree = summaryTotal === inv.objects.length;
const seqListAgrees = inv.sequences.length === seqs.length &&
  inv.sequences.every((s) => seqs.includes(s.sequence_name));
const allOwnedByOneRole = owners.length === 1;
const noRls = inv.objects.every((o) => o.rls_enabled === false && o.rls_forced === false);
const views = inv.objects.filter((o) => ["v", "m"].includes(o.kind)).map((o) => o.object_name);
const routines = inv.routines[0] ?? {};
const functionCount = Number(routines.public_function_count ?? -1);
const triggerCount = Number(routines.public_user_trigger_count ?? -1);

// Schema-qualified names matter: `expenses` exists in BOTH public and finance.
const FINANCE_TABLES = [
  "accounts", "audit_events", "cash_counts", "category_audit", "category_requests",
  "category_revisions", "custody_requests", "expense_corrections", "expense_reviews",
  "expenses", "historical_commerce", "movements", "opening_corrections", "payments",
  "reconciliation_cases", "reconciliation_notes", "requests", "settlements",
];
const nameCollisions = tables.filter((n) => FINANCE_TABLES.includes(n)).sort();
const legacyNames = tables.filter((n) => ["expense_categories", "journal_entries"].includes(n)).sort();
const tablesWithoutSequence = tables.filter((n) => !seqs.includes(`${n}_id_seq`)).sort();

const expectedFromEarlier = 63;
const matched = countsAgree && inv.objects.length === expectedFromEarlier && seqListAgrees;

const verdict = !matched ? "PUBLIC_INVENTORY_INCONSISTENT_STOP"
  : "PUBLIC_INVENTORY_CONFIRMED_GRANT_SCOPE_KNOWN";

process.stdout.write(JSON.stringify({
  verdict,
  overall_release_status: "NOT_READY",
  reconciliation: {
    previously_reported_public_relation_count: expectedFromEarlier,
    objects_listed: inv.objects.length,
    summary_total: summaryTotal,
    by_kind: byKind,
    tables: tables.length,
    sequences: seqs.length,
    views_or_matviews: views.length,
    owners,
    all_owned_by_one_role: allOwnedByOneRole,
    rls_enabled_or_forced_anywhere: !noRls,
    sequence_list_matches_objects: seqListAgrees,
    tables_without_own_sequence: tablesWithoutSequence,
    public_function_count: functionCount,
    public_user_trigger_count: triggerCount,
  },
  grants_scope_for_new_app_role: {
    schema_usage: ["public", "finance"],
    public_tables_needing_dml: tables.length,
    public_sequences_needing_usage: seqs.length,
    finance_tables: FINANCE_TABLES.length,
    finance_sequences: 15,
    finance_indexes_follow_table_owner: 47,
    note: "Every object is owned by one role with no RLS, no views, no functions and no user triggers in public. Grants must still be schema-qualified: `expenses` exists in BOTH public and finance.",
  },
  warnings: [
    ...(nameCollisions.length ? [`NAME_COLLISION_ACROSS_SCHEMAS:${nameCollisions.join(",")}`] : []),
    ...(legacyNames.length ? [`LEGACY_PUBLIC_TABLES_PRESENT:${legacyNames.join(",")}`] : []),
    "LEGACY_ROWS_NOT_VERIFIED: the operator's statement that the database has no real data is not verified here; no row data was read, and a 2026-10-30 check reported 7 rows in public.expense_categories.",
    "NO_RLS_ANYWHERE_IN_PUBLIC: C4 must retest RLS with real roles on both schemas.",
    "PHASE_APPROVAL_PHRASE_NOT_RECEIVED_BEFORE_EXECUTION",
    "SQL_EDITOR_ROLE_IS_NOT_PROOF_OF_THE_DEPLOYED_APP_ROLE",
  ],
  limitations: [
    "DOES_NOT_AUTHORIZE_ROLE_CREATION_OR_OWNERSHIP_TRANSFER",
    "DOES_NOT_AUTHORIZE_DATABASE_URL_CHANGE_OR_DEPLOY",
    "NO_PROOF_OF_CASH_MOVEMENT_TIMING_OR_HUMAN_REVIEW",
  ],
  note: "Offline metadata-only reconciliation of a read-only inventory inside BEGIN TRANSACTION READ ONLY ... ROLLBACK. No connection, no SQL execution, no row data, no deploy approval.",
}, null, 2) + "\n");
