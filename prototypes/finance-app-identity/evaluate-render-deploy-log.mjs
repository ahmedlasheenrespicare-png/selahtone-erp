// Offline evaluator for an operator-pasted Render log. Never connects anywhere,
// never reads env values, and never infers release readiness from "live".
import fs from 'node:fs';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i+1] : undefined; };
const file = arg('file');
if (!file) { console.error('usage: --file <log.txt> [--out <eval.json>]'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8');
const has = (re) => re.test(text);
const markers = {
  clone_from_main: has(/Cloning from .*selahtone-erp[\s\S]*Checking out commit [\da-f]{40} in branch main/),
  base_commit: has(/751d4e55728201a7ce6c5d720a728bf4393ec326/),
  build_command: has(/Running build command/),
  build_successful: has(/Build successful/),
  deploying: has(/==> Deploying\.\.\./),
  service_live: has(/Your service is live/),
  node_20: has(/Node\.js version 20\.20\.2/),
  prisma_6193: has(/Prisma Client \(v6\.19\.3\)/),
  next_15528: has(/Next\.js 15\.5\.28/),
  finance_routes_built: has(/\/finance\/expenses/),
  ready: has(/✓ Ready in/),
};
const fullBuild = markers.build_successful && markers.deploying && markers.service_live;
const envValueShown = has(/(DATABASE_URL|FINANCE_ENABLED)\s*=\s*\S+|"FINANCE_ENABLED"\s*:\s*"(true|false)"/i);
const yearShown = has(/\b(20\d{2})\b/);
const timestampsShown = has(/\b\d{2}:\d{2}:\d{2}\b/);
const dbIdentityShown = has(/current_user|session_user|selahtone_app|neondb_owner|pg_roles|C4|C5|rls_active/i);
const dbErrorShown = has(/P1001|P1017|permission denied for schema|password authentication failed|Tenant or user not found|ECONNREFUSED/i);
const out = {
  evaluator: 'evaluate-render-deploy-log/offline-v1',
  observation: 'RENDER_POST_ENV_CHANGE_LOG',
  markers,
  verdict: fullBuild ? 'FULL_BUILD_AND_DEPLOY_OBSERVED' : 'NO_FULL_DEPLOY_IN_LOG',
  trigger: 'AUTOMATIC_OR_MANUAL_UNDETERMINED',
  code_state: markers.base_commit ? 'CODE_UNCHANGED_FROM_BASE_751d4e5' : 'COMMIT_UNVERIFIED',
  env_values_in_log: envValueShown,
  finance_enabled_state: 'UNVERIFIED_FROM_LOG',
  database_url_switch: 'UNVERIFIED_FROM_LOG',
  database_identity: 'UNVERIFIED_FROM_LOG',
  log_year_present: yearShown,
  log_timestamps_present: timestampsShown,
  db_errors_in_log: dbErrorShown,
  c4_c5_performed: false,
  overall_release_status: 'NOT_READY',
  warnings: [
    'FULL_BUILD_CAME_FROM_BRANCH_MAIN_NOT_THE_WORKING_BRANCH',
    'BLUEPRINT_MAY_HAVE_REAPPLIED_RENDER_YAML_TRUE',
    'FINANCE_ENABLED_MAY_HAVE_RETURNED_TO_TRUE',
    'SERVICE_LIVE_IS_NOT_DB_CONNECTIVITY_PROOF',
    'NEXT_START_DOES_NOT_PROVE_THE_NEW_ROLE_CAN_CONNECT',
    'ENV_VALUES_ARE_NEVER_PRINTED_IN_BUILD_LOGS',
    'LOG_YEAR_ABSENT',
    ...(timestampsShown ? [] : ['LOG_TIMESTAMPS_ABSENT']),
    'LOG_DOES_NOT_PRINT_ENV_VALUES',
    'TRIGGER_AUTOMATIC_OR_MANUAL_UNDETERMINED',
    'NO_PROOF_OF_CASH_MOVEMENT_TIMING_OR_HUMAN_REVIEW',
  ],
  next_gate: 'VERIFY_SETUP_AND_FINANCE_ENABLED_THEN_C4_C5',
  limitations: [
    'DOES_NOT_CONFIRM_DATABASE_URL_VALUE_OR_ROLE',
    'DOES_NOT_CONFIRM_FINANCE_ENABLED_FALSE',
    'DOES_NOT_AUTHORIZE_A_FURTHER_SYNC_OR_MANUAL_DEPLOY',
    'DOES_NOT_AUTHORIZE_FINANCE_ENABLED_TRUE',
    'DOES_NOT_AUTHORIZE_ANY_SQL_OR_DATA_MIGRATION',
  ],
};
const s = JSON.stringify(out, null, 2);
console.log(s);
const o = arg('out'); if (o) fs.writeFileSync(o, s + '\n');
