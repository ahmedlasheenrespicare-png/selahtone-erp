import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EVALUATOR = path.join(
  process.cwd(),
  "prototypes/finance-app-identity/evaluate-render-deploy-log.mjs",
);

const BASE_LOG = [
  "==> Cloning from https://github.com/ahmedlasheenrespicare-png/selahtone-erp",
  "==> Checking out commit 751d4e55728201a7ce6c5d720a728bf4393ec326 in branch main",
  "==> Using Node.js version 20.20.2 via environment variable NODE_VERSION",
  "==> Running build command 'npm install && npx prisma generate && npm run build'...",
  "✔ Generated Prisma Client (v6.19.3) to ./node_modules/@prisma/client in 342ms",
  "   ▲ Next.js 15.5.28",
  " ✓ Compiled successfully in 5.0s",
  " ✓ Generating static pages (8/8)",
  "├ ƒ /finance/expenses                      133 B         121 kB",
  "==> Build successful 🎉",
  "==> Deploying...",
  "==> Running 'npm start'",
  " ✓ Ready in 3.1s",
  "==> Your service is live 🎉",
  "==> Available at your primary URL https://selahtone-erp.onrender.com",
].join("\n");

function evaluate(log: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-log-eval-"));
  const input = path.join(dir, "log.txt");
  fs.writeFileSync(input, log);
  try {
    return JSON.parse(
      execFileSync(process.execPath, [EVALUATOR, "--file", input], { encoding: "utf8" }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the pasted log shows a full build and deploy from branch main, not a mere restart", () => {
  const out = evaluate(BASE_LOG);
  assert.equal(out.verdict, "FULL_BUILD_AND_DEPLOY_OBSERVED");
  assert.equal(out.markers.clone_from_main, true);
  assert.equal(out.markers.build_successful, true);
  assert.equal(out.markers.deploying, true);
  assert.equal(out.markers.service_live, true);
  assert.equal(out.code_state, "CODE_UNCHANGED_FROM_BASE_751d4e5");
  assert.equal(out.trigger, "AUTOMATIC_OR_MANUAL_UNDETERMINED");
});

test("a live service never proves env values, role identity, or DB connectivity", () => {
  const out = evaluate(BASE_LOG);
  assert.equal(out.env_values_in_log, false);
  assert.equal(out.finance_enabled_state, "UNVERIFIED_FROM_LOG");
  assert.equal(out.database_url_switch, "UNVERIFIED_FROM_LOG");
  assert.equal(out.database_identity, "UNVERIFIED_FROM_LOG");
  assert.equal(out.c4_c5_performed, false);
  for (const w of [
    "SERVICE_LIVE_IS_NOT_DB_CONNECTIVITY_PROOF",
    "NEXT_START_DOES_NOT_PROVE_THE_NEW_ROLE_CAN_CONNECT",
    "ENV_VALUES_ARE_NEVER_PRINTED_IN_BUILD_LOGS",
    "BLUEPRINT_MAY_HAVE_REAPPLIED_RENDER_YAML_TRUE",
    "FINANCE_ENABLED_MAY_HAVE_RETURNED_TO_TRUE",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("the log carries no year and no DB errors, and the year fact stays separate", () => {
  const out = evaluate(BASE_LOG);
  assert.equal(out.log_year_present, false);
  assert.equal(out.db_errors_in_log, false);
  assert.ok(out.warnings.includes("LOG_YEAR_ABSENT"));
  const withYear = evaluate("Nov 5, 2026\n" + BASE_LOG);
  assert.equal(withYear.log_year_present, true);
  const withError = evaluate(BASE_LOG + "\nError: P1001 Can't reach database server");
  assert.equal(withError.db_errors_in_log, true);
});

test("no full deploy is inferred when Deploying is absent", () => {
  const noDeploy = BASE_LOG.replace("==> Deploying...\n", "");
  const out = evaluate(noDeploy);
  assert.equal(out.verdict, "NO_FULL_DEPLOY_IN_LOG");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the log never becomes a readiness or deploy authorization", () => {
  const out = evaluate(BASE_LOG);
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.next_gate, "VERIFY_SETUP_AND_FINANCE_ENABLED_THEN_C4_C5");
  for (const l of [
    "DOES_NOT_CONFIRM_FINANCE_ENABLED_FALSE",
    "DOES_NOT_AUTHORIZE_A_FURTHER_SYNC_OR_MANUAL_DEPLOY",
    "DOES_NOT_AUTHORIZE_FINANCE_ENABLED_TRUE",
    "DOES_NOT_AUTHORIZE_ANY_SQL_OR_DATA_MIGRATION",
  ]) assert.ok(out.limitations.includes(l), l);
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"(READY|DEPLOY_READY|PHASE4_COMPLETE|C4_PASS|C5_PASS)"/);
});


test("a log without timestamps or a year is recorded as such", () => {
  const out = evaluate(BASE_LOG);
  assert.equal(out.log_year_present, false);
  assert.equal(out.log_timestamps_present, false);
  assert.ok(out.warnings.includes("LOG_TIMESTAMPS_ABSENT"));
  assert.ok(out.warnings.includes("LOG_DOES_NOT_PRINT_ENV_VALUES"));
  const timed = evaluate("07:36:52 PM ==> Build successful" + BASE_LOG);
  assert.equal(timed.log_timestamps_present, true);
});
