#!/usr/bin/env node
/**
 * TEST ONLY — offline evaluator for the reviewed app-connection probe result.
 * It NEVER opens a database connection. It reads aggregate JSON objects
 * (the `app_connection_probe` column) from stdin or files, refuses anything
 * that looks like a connection string, extra field, or row data, and prints a
 * verdict against docs/finance-app-identity-readiness-ar.md §5.
 *
 *   node evaluate-app-connection-probe.mjs < probe.json
 *   node evaluate-app-connection-probe.mjs --file probe.json
 *   node evaluate-app-connection-probe.mjs --file first.json --compare second.json
 *
 * `--compare` evaluates C3 (identity stability under the pooler) using two
 * INDEPENDENT connections. C1/C2 remain measured from the first report, C4/C5
 * remain external, and overall_release_status is ALWAYS NOT_READY — a stable
 * identity is not proof of the deployed app's identity, nor of readiness.
 *
 * It never echoes the input. A verdict is deliberately never "READY".
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT_KEYS = [
  "probe_scope", "probe_version", "read_only_transaction", "current_user", "session_user",
  "role_flags", "inherited_roles", "inherits_write_all_data", "inherits_read_all_data",
  "can_create_schema", "finance_schema_present", "finance_schema_owned_by_current_user",
  "can_create_in_finance", "finance_object_count", "finance_objects", "limitations",
];
const OBJECT_KEYS = [
  "table_name", "owned_by_current_user", "can_select", "can_insert", "can_update",
  "can_delete", "can_truncate", "rls_active",
];
const ROLE_FLAG_KEYS = ["superuser", "inherit", "create_role", "create_db", "can_login", "replication", "bypass_rls"];
// Fields whose equality across two connections is what C3 actually asserts.
const IDENTITY_KEYS = [
  "probe_scope", "probe_version", "read_only_transaction", "current_user", "session_user",
  "role_flags", "inherited_roles", "inherits_write_all_data", "inherits_read_all_data",
  "can_create_schema", "finance_schema_present", "finance_schema_owned_by_current_user",
  "can_create_in_finance", "finance_object_count", "finance_objects",
];
// Roles whose membership defeats SELECT/INSERT/DELETE/UPDATE revokes or RLS.
const BROAD_ROLE = /pg_write_all_data|pg_read_all_data|write_all_data|read_all_data|bypassrls|superuser|neon_superuser/i;

function reject(code) { process.stdout.write(JSON.stringify({ verdict: "INPUT_REJECTED", reason: code }) + "\n"); process.exit(1); }

const argv = process.argv.slice(2);
let firstPath = null, secondPath = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--file" && firstPath === null) firstPath = argv[++i] ?? null;
  else if (argv[i] === "--compare" && secondPath === null) secondPath = argv[++i] ?? null;
  else reject("BAD_ARGUMENT");
}
if (argv.includes("--compare") && !secondPath) reject("NO_SECOND_INPUT");
if (firstPath && secondPath && firstPath === secondPath) reject("SAME_FILE_NOT_TWO_CONNECTIONS");

function readRaw(filePath, code) {
  try { return filePath ? readFileSync(filePath, "utf8") : readFileSync(0, "utf8"); }
  catch { reject(code); }
}

/** Fail closed BEFORE parsing: the operator must paste the aggregate only. */
function validate(raw) {
  if (/postgresql:\/\/|postgres:\/\/|sslmode|password|rolpassword|BEGIN TRANSACTION|SELECT .* FROM finance\./i.test(raw)) reject("CONNECTION_OR_ROW_DATA_IN_INPUT");
  if (raw.length > 64_000) reject("INPUT_TOO_LARGE");
  let probe;
  try { probe = JSON.parse(raw); } catch { reject("INVALID_JSON"); }
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) reject("NOT_AN_OBJECT");
  const extra = Object.keys(probe).filter((k) => !ROOT_KEYS.includes(k));
  if (extra.length) reject("UNEXPECTED_FIELDS");
  const missing = ROOT_KEYS.filter((k) => !(k in probe));
  if (missing.length) reject("MISSING_FIELDS");
  if (probe.probe_scope !== "APP_CONNECTION_ONLY" || probe.probe_version !== "1.1") reject("WRONG_PROBE_VERSION");
  if (probe.read_only_transaction !== true) reject("NOT_READ_ONLY");
  if (!Array.isArray(probe.inherited_roles) || !Array.isArray(probe.finance_objects) || !Array.isArray(probe.limitations)) reject("BAD_SHAPE");
  if (!probe.role_flags || typeof probe.role_flags !== "object" || ROLE_FLAG_KEYS.some((k) => typeof probe.role_flags[k] !== "boolean")) reject("BAD_ROLE_FLAGS");
  for (const o of probe.finance_objects) {
    if (!o || typeof o !== "object" || Object.keys(o).some((k) => !OBJECT_KEYS.includes(k)) || OBJECT_KEYS.some((k) => !(k in o))) reject("BAD_FINANCE_OBJECT");
    if (typeof o.can_delete !== "boolean" || typeof o.can_truncate !== "boolean" || typeof o.rls_active !== "boolean" || typeof o.owned_by_current_user !== "boolean") reject("BAD_FINANCE_OBJECT_TYPES");
  }
  return probe;
}

/** Order-independent canonical form, so key order can never fake a match. */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}
const canonical = (v) => JSON.stringify(stable(v));
const digest = (v) => createHash("sha256").update(canonical(v)).digest("hex");

const probe = validate(readRaw(firstPath, "NO_INPUT"));
const second = secondPath ? validate(readRaw(secondPath, "NO_SECOND_INPUT")) : null;

const criteria = [];
const add = (id, status, detail) => criteria.push({ id, status, detail });

// Criterion 1: no inherited broad write/read role, no CREATE in finance.
const broad = [
  ...(probe.inherits_write_all_data ? ["inherits_write_all_data=true"] : []),
  ...(probe.inherits_read_all_data ? ["inherits_read_all_data=true"] : []),
  ...probe.inherited_roles.filter((r) => BROAD_ROLE.test(String(r))).map((r) => `inherited_role:${r}`),
  ...ROLE_FLAG_KEYS.filter((k) => ["superuser", "bypass_rls", "create_role", "create_db"].includes(k) && probe.role_flags[k]).map((k) => `role_flag:${k}`),
];
const createInFinance = probe.can_create_in_finance;
if (broad.length) add("C1_no_broad_role", "FAIL", broad.join(","));
else if (createInFinance === null) add("C1_no_broad_role", "INCOMPLETE", "finance schema absent; can_create_in_finance=null");
else if (createInFinance === true || probe.can_create_schema === true) add("C1_no_broad_role", "FAIL", "role can CREATE in finance or in the database");
else add("C1_no_broad_role", "PASS", "no broad membership, no CREATE privilege");

// Criterion 2: the app role cannot delete/truncate, does not own the tables, RLS active.
if (!probe.finance_schema_present || probe.finance_object_count === 0) {
  add("C2_table_privileges", "NOT_APPLICABLE", "finance schema/objects absent; nothing to verify yet");
} else {
  const bad = probe.finance_objects.filter((o) => o.can_delete || o.can_truncate || o.owned_by_current_user);
  // A role with BYPASSRLS defeats RLS policies even if they are enabled later,
  // so rls_active=false cannot be read as "decision pending" in that case.
  const bypass = probe.role_flags.bypass_rls === true;
  if (bad.length || bypass) add("C2_table_privileges", "FAIL",
    `${bad.length} object(s) deletable/truncatable/owned by app role${bypass ? "; bypass_rls=true makes RLS ineffective" : ""}`);
  else if (probe.finance_objects.some((o) => !o.rls_active)) add("C2_table_privileges", "INCOMPLETE", "RLS decision not recorded yet (rls_active=false)");
  else add("C2_table_privileges", "PASS", `${probe.finance_objects.length} objects checked`);
}

// Criterion 3: identity stability under the pooler needs two connections.
let comparison = null;
if (second) {
  const differing = IDENTITY_KEYS.filter((k) => canonical(probe[k]) !== canonical(second[k]));
  const firstSha = digest(probe), secondSha = digest(second);
  comparison = {
    mode: "TWO_CONNECTIONS",
    identity_fields_compared: IDENTITY_KEYS.length,
    differing_identity_fields: differing,
    whole_aggregate_identical: firstSha === secondSha,
    first_canonical_sha256: firstSha,
    second_canonical_sha256: secondSha,
  };
  if (differing.length) add("C3_stable_identity", "FAIL",
    `identity differs between connections in ${differing.length} field(s): ${differing.join(",")}`);
  else add("C3_stable_identity", "PASS",
    `two independent connections produced an identical identity aggregate (sha256=${firstSha.slice(0, 12)}…)`);
} else {
  add("C3_stable_identity", "REQUIRES_SECOND_CONNECTION",
    `current_user=${String(probe.current_user)}; session_user=${String(probe.session_user)}; repeat the probe on a second connection before trusting it`);
}

// Criteria 4 and 5 are external by definition.
add("C4_real_role_guard_retest", "REQUIRES_SEPARATE_STEP", "re-run the 19-object cutover guard and atomic tests with real roles");
add("C5_review_and_approvals", "REQUIRES_SEPARATE_STEP", "independent SQL review, separate deploy approval, post-run check");

const statuses = criteria.map((c) => c.status);
let verdict;
if (statuses.includes("FAIL")) verdict = "IDENTITY_GAP_CONFIRMED";
else if (!probe.finance_schema_present || statuses.includes("INCOMPLETE") || statuses.includes("NOT_APPLICABLE")) verdict = "INCOMPLETE_SCHEMA_OR_DECISION";
else verdict = "IDENTITY_FIELDS_PASS_EXTERNAL_STEPS_PENDING";

// Deliberately never READY. A stable C3 only closes one measurable field; it is
// not proof that the DEPLOYED app uses this connection, nor that C4/C5 are done.
process.stdout.write(JSON.stringify({
  verdict,
  overall_release_status: "NOT_READY",
  criteria,
  ...(comparison ? { comparison } : {}),
  note: second
    ? "Evaluates two independent connections offline. Stable identity does NOT prove the deployed app identity; C4/C5 and all approvals remain separate. Not a deploy, migration, or proof of cash movement, timing, or human review."
    : "This evaluates one probe over one connection only. It is not a deploy, not a migration, and not proof of cash movement, timing, or human review.",
}, null, 2) + "\n");
