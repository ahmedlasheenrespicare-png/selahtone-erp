import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EVALUATOR = path.join(
  process.cwd(),
  "prototypes/finance-app-identity/evaluate-phase4-execution.mjs",
);

const GOOD = [
  {
    rolname: "selahtone_app",
    rolsuper: false,
    rolbypassrls: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    inherits_neon_superuser: false,
  },
  {
    rolname: "selahtone_finance_admin",
    rolsuper: false,
    rolbypassrls: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    inherits_neon_superuser: false,
  },
];

function evaluate(rows: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase4-eval-"));
  const input = path.join(dir, "result.json");
  fs.writeFileSync(input, JSON.stringify(rows));
  try {
    const stdout = execFileSync(process.execPath, [EVALUATOR, "--file", input], {
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the operator's two observed role rows match the expected early-check shape", () => {
  const out = evaluate(GOOD);
  assert.equal(out.observation, "EARLY_ROLE_ATTRIBUTE_CHECK_ONLY");
  assert.equal(out.early_check_verdict, "EARLY_ROLE_CHECK_MATCHES_EXPECTED_SHAPE");
  assert.deepEqual(out.rejection_reasons, []);
});

test("a partial observation never becomes a batch-success or COMMIT proof", () => {
  const out = evaluate(GOOD);
  assert.equal(out.batch_verdict, "PARTIAL_RESULT_ONLY_NOT_A_PROOF_OF_BATCH_SUCCESS");
  assert.equal(out.commit_status, "UNVERIFIED");
  assert.equal(out.rollback_status, "UNVERIFIED");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.final_verification_received.counts_80_80_0, false);
  assert.equal(out.final_verification_received.false_true_false, false);
  assert.equal(out.final_verification_received.zero_owner_mismatch_rows, false);
  assert.equal(out.final_verification_received.app_can_connect, false);
  assert.ok(out.warnings.includes("ONLY_1_OF_5_VERIFICATION_SELECTS_RECEIVED"));
  assert.ok(out.warnings.includes("NO_COMMIT_OR_ROLLBACK_CONFIRMATION"));
  assert.ok(out.warnings.includes("DOES_NOT_AUTHORIZE_DATABASE_URL_CHANGE_OR_DEPLOY"));
});

test("any true flag, unknown role, extra field, or extra row is rejected", () => {
  const withTrue = structuredClone(GOOD) as Record<string, unknown>[];
  withTrue[0].rolbypassrls = true;
  assert.equal(evaluate(withTrue).early_check_verdict, "EARLY_ROLE_CHECK_REJECTED");
  assert.ok(evaluate(withTrue).rejection_reasons.some((r: string) => r.startsWith("FLAG_NOT_FALSE")));

  const unknown = structuredClone(GOOD) as Record<string, unknown>[];
  unknown[1].rolname = "neondb_owner";
  assert.equal(evaluate(unknown).early_check_verdict, "EARLY_ROLE_CHECK_REJECTED");

  const extra = structuredClone(GOOD) as Record<string, unknown>[];
  extra[0].amount = "9182.31";
  assert.ok(evaluate(extra).rejection_reasons.some((r: string) => r === "UNEXPECTED_FIELD:amount"));

  assert.ok(evaluate([...GOOD, GOOD[0]]).rejection_reasons.some((r: string) => r === "UNEXPECTED_ROW_COUNT:3"));
  assert.equal(evaluate([GOOD[0]]).early_check_verdict, "EARLY_ROLE_CHECK_REJECTED");
  assert.equal(evaluate({ rows: GOOD }).early_check_verdict, "EARLY_ROLE_CHECK_REJECTED");
});

test("the evaluator never emits a deploy-ready or success verdict", () => {
  const out = evaluate(GOOD);
  const text = JSON.stringify(out);
  // match whole quoted values only: "NOT_A_PROOF_OF_BATCH_SUCCESS" must NOT count as BATCH_SUCCESS
  assert.doesNotMatch(text, /"(COMMIT_CONFIRMED|DEPLOY_READY|BATCH_SUCCESS|READY_TO_DEPLOY|PHASE4_COMPLETE|READY)"/);
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.commit_status, "UNVERIFIED");
  assert.match(text, /ROLE_EXISTENCE_INSIDE_AN_UNCOMMITTED_TRANSACTION_IS_NOT_PERSISTENCE/);
  assert.match(text, /SQL_EDITOR_ROLE_IS_NOT_PROOF_OF_THE_DEPLOYED_APP_ROLE/);
  assert.match(text, /NO_PROOF_OF_CASH_MOVEMENT_TIMING_OR_HUMAN_REVIEW/);
});

test("limits of the observation are explicit and the deploy gate stays shut", () => {
  const out = evaluate(GOOD);
  for (const l of [
    "DOES_NOT_CONFIRM_THE_BATCH_SUCCEEDED",
    "DOES_NOT_CONFIRM_OWNERSHIP_TRANSFER_OF_80_OBJECTS",
    "DOES_NOT_CONFIRM_GRANTS_OR_RLS_STATE",
    "DOES_NOT_AUTHORIZE_FINANCE_ENABLED_TRUE",
  ]) {
    assert.ok(out.limitations.includes(l), l);
  }
  assert.ok(out.warnings.includes("DOES_NOT_AUTHORIZE_DATABASE_URL_CHANGE_OR_DEPLOY"));
});


const ACCUMULATED = {
  early_role_check: GOOD,
  privilege_check: {
    app_can_delete_finance: false,
    app_can_read_public: true,
    app_can_create_in_finance: false,
  },
  ownership_check: { finance_object_count: 80, owned_by_admin: 80, owned_by_app: 0 },
  zero_owner_mismatch_rows_received: false,
  app_can_connect_received: false,
  operator_statement_status: "Statement executed successfully",
};

test("the accumulated observation accepts the privilege and ownership checks", () => {
  const out = evaluate(ACCUMULATED);
  assert.equal(out.early_check_verdict, "EARLY_ROLE_CHECK_MATCHES_EXPECTED_SHAPE");
  assert.equal(out.privilege_check_verdict, "PRIVILEGE_CHECK_MATCHES_EXPECTED_SHAPE");
  assert.equal(out.ownership_check_verdict, "OWNERSHIP_CHECK_MATCHES_EXPECTED_SHAPE");
  assert.equal(out.verification_selects_received_of_five, 3);
  assert.equal(out.observed_checks_all_match, true);
  assert.equal(out.final_verification_received.false_true_false, true);
  assert.equal(out.final_verification_received.counts_80_80_0, true);
  assert.equal(out.final_verification_received.zero_owner_mismatch_rows, false);
  assert.equal(out.final_verification_received.app_can_connect, false);
});

test("matching checks still never confirm COMMIT, rollback, or deploy readiness", () => {
  const out = evaluate(ACCUMULATED);
  assert.equal(out.batch_verdict, "ALL_OBSERVED_CHECKS_MATCH_BUT_COMMIT_UNVERIFIED");
  assert.equal(out.commit_status, "UNVERIFIED");
  assert.equal(out.rollback_status, "UNVERIFIED");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.operator_statement_status, "Statement executed successfully");
  assert.ok(out.warnings.includes("ONLY_3_OF_5_VERIFICATION_SELECTS_RECEIVED"));
  assert.ok(out.warnings.includes("STATEMENT_EXECUTED_SUCCESSFULLY_IS_NOT_A_COMMIT_CONFIRMATION"));
  assert.ok(out.warnings.includes("RESULTS_OBSERVED_INSIDE_A_TRANSACTION_ARE_NOT_PERSISTENCE"));
  assert.ok(out.warnings.includes("DOES_NOT_AUTHORIZE_DATABASE_URL_CHANGE_OR_DEPLOY"));
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"(COMMIT_CONFIRMED|DEPLOY_READY|BATCH_SUCCESS|READY_TO_DEPLOY|PHASE4_COMPLETE|READY)"/);
});

test("a wrong privilege or ownership value is rejected even if the early check passed", () => {
  const badPriv = structuredClone(ACCUMULATED) as Record<string, any>;
  badPriv.privilege_check.app_can_delete_finance = true;
  const a = evaluate(badPriv);
  assert.equal(a.privilege_check_verdict, "PRIVILEGE_CHECK_REJECTED");
  assert.equal(a.batch_verdict, "PARTIAL_RESULT_ONLY_NOT_A_PROOF_OF_BATCH_SUCCESS");

  const badOwn = structuredClone(ACCUMULATED) as Record<string, any>;
  badOwn.ownership_check.owned_by_admin = 79;
  const b = evaluate(badOwn);
  assert.equal(b.ownership_check_verdict, "OWNERSHIP_CHECK_REJECTED");
  assert.ok(b.ownership_check_rejection_reasons.includes("owned_by_admin_NOT_80"));

  const extra = structuredClone(ACCUMULATED) as Record<string, any>;
  extra.ownership_check.amount = "9182.31";
  assert.ok(evaluate(extra).ownership_check_rejection_reasons.includes("UNEXPECTED_OWN_FIELD:amount"));
});


const COMMITTED = { ...structuredClone(ACCUMULATED), commit_confirmation: "نفّذت COMMIT;" };

test("an explicit operator COMMIT closes only the SQL gate", () => {
  const out = evaluate(COMMITTED);
  assert.equal(out.batch_verdict, "PHASE4_SQL_BATCH_APPLIED_BY_OPERATOR_REPORT");
  assert.equal(out.commit_status, "CONFIRMED_BY_OPERATOR");
  assert.equal(out.commit_confirmation_is, "OPERATOR_REPORT_NOT_SESSION_VERIFICATION");
  assert.equal(out.phase4_sql_gate, "CLOSED_SQL_ONLY");
  assert.equal(out.next_gate, "SEPARATE_DEPLOY_APPROVAL_FOR_DATABASE_URL");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("a committed batch still leaves the deployed app on the old identity", () => {
  const out = evaluate(COMMITTED);
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  for (const w of [
    "OPERATOR_REPORTED_COMMIT_NOT_SESSION_VERIFIED",
    "APP_STILL_USES_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGE",
    "C1_C2_STILL_FAIL_FOR_THE_DEPLOYED_APP",
    "NEONDB_OWNER_RETAINS_ADMIN_ROLE_MEMBERSHIP_BY_DESIGN",
    "REQUIRES_SEPARATE_DEPLOY_APPROVAL",
    "REQUIRES_C4_C5_BEFORE_ANY_DEPLOY",
    "NEW_ROLE_CONNECTIVITY_AND_RLS_NOT_YET_TESTED",
  ]) assert.ok(out.warnings.includes(w), w);
  for (const l of [
    "DOES_NOT_AUTHORIZE_DATABASE_URL_CHANGE_OR_DEPLOY",
    "DOES_NOT_AUTHORIZE_FINANCE_ENABLED_TRUE",
    "DOES_NOT_CONFIRM_RLS_STATE_OR_TRIGGER_BEHAVIOR_UNDER_NEW_ROLE",
    "DOES_NOT_CONFIRM_APP_CONNECTIVITY_WITH_NEW_ROLE",
  ]) assert.ok(out.limitations.includes(l), l);
});

test("COMMIT never becomes a deploy approval, and ROLLBACK wording is not a COMMIT", () => {
  const out = evaluate(COMMITTED);
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"(COMMIT_CONFIRMED|DEPLOY_READY|BATCH_SUCCESS|READY_TO_DEPLOY|PHASE4_COMPLETE|READY|DEPLOY_APPROVED)"/);
  assert.doesNotMatch(flat, /"overall_release_status":"READY"/);
  const rollback = { ...structuredClone(ACCUMULATED), commit_confirmation: "نفّذت ROLLBACK;" };
  const r = evaluate(rollback);
  assert.equal(r.commit_status, "UNVERIFIED");
  assert.equal(r.batch_verdict, "ALL_OBSERVED_CHECKS_MATCH_BUT_COMMIT_UNVERIFIED");
  assert.equal(r.phase4_sql_gate, "OPEN_SQL");
});


const DEPLOY_APPROVED = {
  ...structuredClone(COMMITTED),
  deploy_approval: "راجعتُ خطة تغيير DATABASE_URL وخطة الرجوع، وأُجيز ضبط المتغير في Render دون نشر أو إعادة تفعيل",
};

test("the separate deploy phrase opens only the env-var gate", () => {
  const out = evaluate(DEPLOY_APPROVED);
  assert.equal(out.deploy_gate, "OPEN_ENV_VAR_ONLY");
  assert.equal(out.deploy_scope, "DATABASE_URL_VALUE_ONLY_NO_DEPLOY_NO_REENABLE");
  assert.equal(out.deploy_approval_is, "SEPARATE_EXPLICIT_PHRASE_RECEIVED_BEFORE_ACTION");
  assert.equal(out.next_gate, "C4_C5_VERIFICATION_AFTER_ENV_CHANGE");
  assert.equal(out.phase4_sql_gate, "CLOSED_SQL_ONLY");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("an env approval never becomes a code deploy, re-enable, or readiness proof", () => {
  const out = evaluate(DEPLOY_APPROVED);
  for (const w of [
    "ENV_CHANGE_TRIGGERS_AUTOMATIC_RESTART_NOT_A_CODE_DEPLOY",
    "DO_NOT_SYNC_BLUEPRINT_BECAUSE_RENDER_YAML_STILL_TRUE",
    "FINANCE_ENABLED_MUST_REMAIN_FALSE",
    "REQUIRES_C4_C5_BEFORE_ANY_REENABLE",
    "DO_NOT_SEND_THE_URL_OR_PASSWORD_TO_THE_CHAT",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.ok(out.limitations.includes("DOES_NOT_AUTHORIZE_A_CODE_DEPLOY_OR_MANUAL_DEPLOY"));
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"(COMMIT_CONFIRMED|DEPLOY_READY|BATCH_SUCCESS|READY_TO_DEPLOY|PHASE4_COMPLETE|READY|DEPLOY_APPROVED)"/);
});

test("a deploy phrase without the explicit no-deploy exclusion does not open the gate", () => {
  const broad = {
    ...structuredClone(COMMITTED),
    deploy_approval: "راجعتُ خطة تغيير DATABASE_URL وأُجيز النشر وإعادة التفعيل",
  };
  const out = evaluate(broad);
  assert.equal(out.deploy_gate, "CLOSED");
  assert.equal(out.next_gate, "SEPARATE_DEPLOY_APPROVAL_FOR_DATABASE_URL");
  assert.equal(out.overall_release_status, "NOT_READY");
});


const REENABLED = {
  ...structuredClone(DEPLOY_APPROVED),
  post_deploy_observation: {
    operator_reenabled_finance_enabled: true,
    finance_redirects_to_dashboard: false,
    connection_errors_in_log: false,
  },
};

test("an operator re-enable is recorded as outside the separate approval", () => {
  const out = evaluate(REENABLED);
  assert.equal(out.finance_enabled_state, "TRUE_BY_OPERATOR_REPORT");
  assert.equal(out.finance_exposure, "EXPOSED_BEFORE_C4_C5");
  assert.equal(out.reenable_scope, "REENABLE_NOT_COVERED_BY_THE_APPROVAL_PHRASE");
  assert.equal(out.next_gate, "RESTORE_FALSE_THEN_C4_C5");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
});

test("no errors in the log never becomes a connectivity or readiness proof", () => {
  const out = evaluate(REENABLED);
  assert.equal(out.no_errors_in_log_is, "NOT_A_CONNECTIVITY_PROOF");
  for (const w of [
    "REENABLE_NOT_COVERED_BY_THE_APPROVAL_PHRASE",
    "FINANCE_SURFACE_OPEN_BEFORE_RLS_AND_TRIGGER_TESTS",
    "EITHER_IDENTITY_IS_UNSAFE_NEONDB_OWNER_OR_UNTESTED_APP_ROLE",
    "NO_ERRORS_IN_LOG_IS_NOT_A_CONNECTIVITY_PROOF",
    "ERRORS_MAY_APPEAR_ONLY_ON_FIRST_WRITE",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
    "DO_NOT_RUN_ANY_FINANCIAL_ACTION_OR_WRITE",
    "NO_PROOF_OF_CASH_MOVEMENT_TIMING_OR_HUMAN_REVIEW",
  ]) assert.ok(out.warnings.includes(w), w);
  for (const l of [
    "DOES_NOT_AUTHORIZE_REENABLING_OR_WIDENING_THE_APPROVAL",
    "DOES_NOT_CONFIRM_THE_NEW_ROLE_CAN_CONNECT_OR_WRITE",
  ]) assert.ok(out.limitations.includes(l), l);
});

test("reporting false instead keeps the non-exposed state and the C4/C5 gate", () => {
  const restored = {
    ...structuredClone(DEPLOY_APPROVED),
    post_deploy_observation: {
      operator_reenabled_finance_enabled: false,
      finance_redirects_to_dashboard: true,
      connection_errors_in_log: false,
    },
  };
  const out = evaluate(restored);
  assert.equal(out.finance_exposure, "NOT_EXPOSED_OR_UNVERIFIED");
  assert.equal(out.next_gate, "C4_C5_VERIFICATION_AFTER_ENV_CHANGE");
  assert.equal(out.reenable_scope, null);
  assert.equal(out.overall_release_status, "NOT_READY");
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"(READY|DEPLOY_READY|PHASE4_COMPLETE|READY_TO_DEPLOY)"/);
});


const RESTORED = {
  ...structuredClone(REENABLED),
  post_restore_observation: {
    operator_restored_finance_enabled: true,
    restore_deploy_log_provided: true,
    setup_and_redirect_verified: false,
  },
};

test("restoring false is corrective, not a new approval or readiness", () => {
  const out = evaluate(RESTORED);
  assert.equal(out.finance_enabled_state, "FALSE_BY_OPERATOR_REPORT_UNVERIFIED_IN_UI");
  assert.equal(out.finance_exposure, "RESTORED_BUT_UI_UNVERIFIED");
  assert.equal(out.restore_scope, "CORRECTIVE_RETURN_TO_AUTHORIZED_STATE_NOT_A_NEW_APPROVAL");
  assert.equal(out.next_gate, "VERIFY_SETUP_AND_REDIRECT_THEN_C4_C5");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
});

test("a restore build log never proves the env value, connectivity, or C4/C5", () => {
  const out = evaluate(RESTORED);
  for (const w of [
    "RESTORATION_IS_NOT_A_UI_OR_PROCESS_VERIFICATION",
    "LOG_DOES_NOT_PRINT_ENV_VALUES",
    "SECOND_FULL_BUILD_FROM_MAIN_SAME_COMMIT",
    "RENDER_YAML_STILL_TRUE_DO_NOT_SYNC",
    "SERVICE_LIVE_IS_NOT_DB_CONNECTIVITY_PROOF",
    "C4_C5_NOT_PERFORMED",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
    "DO_NOT_RUN_ANY_FINANCIAL_ACTION_OR_WRITE",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.ok(out.limitations.includes("DOES_NOT_AUTHORIZE_REENABLING_OR_A_FURTHER_SYNC"));
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"(READY|DEPLOY_READY|PHASE4_COMPLETE|READY_TO_DEPLOY)"/);
});

test("only a UI check of setup and redirect advances the gate to C4/C5", () => {
  const verified = {
    ...structuredClone(RESTORED),
    post_restore_observation: {
      operator_restored_finance_enabled: true,
      restore_deploy_log_provided: true,
      setup_and_redirect_verified: true,
    },
  };
  const out = evaluate(verified);
  assert.equal(out.finance_enabled_state, "FALSE_BY_OPERATOR_REPORT_AND_UI_CHECK");
  assert.equal(out.finance_exposure, "RESTORED_AND_UI_VERIFIED");
  assert.equal(out.next_gate, "C4_C5_VERIFICATION");
  assert.equal(out.overall_release_status, "NOT_READY");
});


const SETUP_ONLY = {
  ...structuredClone(RESTORED),
  setup_observation: {
    setup_card_text: "حالة وحدة المالية ومخطط الحسابات / معطّلة مرحليًا / وحدة المالية متوقفة اختياريًا عبر FINANCE_ENABLED",
    setup_shows_disabled: true,
    finance_redirects_to_dashboard: null,
  },
};

test("the /setup card verifies the UI indicator but leaves the redirect unchecked", () => {
  const out = evaluate(SETUP_ONLY);
  assert.equal(out.finance_enabled_state, "FALSE_BY_OPERATOR_REPORT_SETUP_SHOWS_DISABLED_REDIRECT_UNVERIFIED");
  assert.equal(out.finance_exposure, "RESTORED_SETUP_VERIFIED_REDIRECT_UNVERIFIED");
  assert.deepEqual(out.setup_and_redirect_checks, { setup_verified: true, redirect_verified: false });
  assert.equal(out.next_gate, "VERIFY_FINANCE_REDIRECT_THEN_C4_C5");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the setup card is not a process measurement and does not distinguish false from missing", () => {
  const out = evaluate(SETUP_ONLY);
  for (const w of [
    "SETUP_CARD_IS_A_UI_INDICATOR_NOT_A_PROCESS_MEASUREMENT",
    "financeEnabled_DOES_NOT_DISTINGUISH_FALSE_FROM_MISSING",
    "REDIRECT_CHECK_STILL_MISSING",
    "SETUP_CARD_DOES_NOT_PROVE_THE_DATABASE_URL_OR_ROLE",
    "C4_C5_NOT_PERFORMED",
    "DO_NOT_RUN_ANY_FINANCIAL_ACTION_OR_WRITE",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.ok(out.limitations.includes("DOES_NOT_CONFIRM_THE_EXACT_ENV_VALUE_OR_THE_NEW_ROLE"));
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
});

test("both UI checks are required before the C4/C5 gate opens", () => {
  const both = {
    ...structuredClone(SETUP_ONLY),
    setup_observation: {
      setup_card_text: "معطّلة مرحليًا",
      setup_shows_disabled: true,
      finance_redirects_to_dashboard: true,
    },
  };
  const out = evaluate(both);
  assert.deepEqual(out.setup_and_redirect_checks, { setup_verified: true, redirect_verified: true });
  assert.equal(out.finance_exposure, "RESTORED_AND_UI_VERIFIED");
  assert.equal(out.next_gate, "C4_C5_VERIFICATION");
  assert.equal(out.overall_release_status, "NOT_READY");
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"(READY|DEPLOY_READY|PHASE4_COMPLETE|READY_TO_DEPLOY)"/);
});


const AMBIGUOUS_SURFACE = {
  ...structuredClone(SETUP_ONLY),
  finance_surface_observation: {
    operator_text: "الصفحات الخاصه بالماليه غير موجوده",
    explicit_redirect_to_dashboard: false,
    explicit_404: false,
    menu_links_hidden: null,
  },
};

test("'pages are gone' is ambiguous and is not a redirect proof", () => {
  const out = evaluate(AMBIGUOUS_SURFACE);
  assert.equal(out.finance_surface_observation.verdict, "AMBIGUOUS_NEEDS_DISAMBIGUATION");
  assert.deepEqual(out.setup_and_redirect_checks, { setup_verified: true, redirect_verified: false });
  assert.equal(out.finance_exposure, "RESTORED_SETUP_VERIFIED_REDIRECT_UNVERIFIED");
  assert.equal(out.next_gate, "DISAMBIGUATE_FINANCE_REDIRECT_THEN_C4_C5");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.finance_surface_observation.build_log_shows_finance_routes_built, true);
});

test("hidden menu is expected when false, but a 404 needs investigation", () => {
  const out = evaluate(AMBIGUOUS_SURFACE);
  for (const w of [
    "AMBIGUOUS_OBSERVATION_IS_NOT_A_REDIRECT_PROOF",
    "HIDDEN_MENU_IS_EXPECTED_WHEN_FINANCE_DISABLED",
    "ROUTES_EXIST_IN_BUILD_SO_ABSENCE_IS_NOT_DELETION",
    "DO_NOT_INFER_READINESS_FROM_AN_AMBIGUOUS_OBSERVATION",
    "C4_C5_NOT_PERFORMED",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.ok(out.limitations.includes("DOES_NOT_CONFIRM_THE_FINANCE_REDIRECT_BEHAVIOR"));
  const four04 = {
    ...structuredClone(AMBIGUOUS_SURFACE),
    finance_surface_observation: { operator_text: "404", explicit_redirect_to_dashboard: false, explicit_404: true },
  };
  const f = evaluate(four04);
  assert.equal(f.finance_surface_observation.verdict, "DIRECT_URL_404");
  assert.equal(f.next_gate, "INVESTIGATE_FINANCE_404_BEFORE_C4_C5");
  assert.ok(f.warnings.includes("DO_NOT_TREAT_404_AS_A_DISABLED_FEATURE_WITHOUT_INVESTIGATION"));
});

test("an explicit redirect report is what actually opens the C4/C5 gate", () => {
  const redirected = {
    ...structuredClone(AMBIGUOUS_SURFACE),
    finance_surface_observation: { operator_text: "يحوّل إلى /dashboard", explicit_redirect_to_dashboard: true, explicit_404: false },
  };
  const out = evaluate(redirected);
  assert.equal(out.finance_surface_observation.verdict, "REDIRECT_CONFIRMED");
  assert.equal(out.next_gate, "VERIFY_FINANCE_REDIRECT_THEN_C4_C5");
  const both = {
    ...structuredClone(redirected),
    setup_observation: { setup_shows_disabled: true, finance_redirects_to_dashboard: true },
  };
  const b = evaluate(both);
  assert.equal(b.finance_exposure, "RESTORED_AND_UI_VERIFIED");
  assert.equal(b.next_gate, "C4_C5_VERIFICATION");
  assert.equal(b.overall_release_status, "NOT_READY");
});


const REDIRECT_CONFIRMED = {
  ...structuredClone(AMBIGUOUS_SURFACE),
  setup_observation: {
    setup_shows_disabled: true,
    finance_redirects_to_dashboard: true,
  },
  finance_surface_observation: {
    operator_text: "اذا فتحت /finance يحول الي dashboard",
    explicit_redirect_to_dashboard: true,
    explicit_404: false,
  },
};

test("an explicit redirect completes both UI checks and opens the C4/C5 gate", () => {
  const out = evaluate(REDIRECT_CONFIRMED);
  assert.equal(out.finance_surface_observation.verdict, "REDIRECT_CONFIRMED");
  assert.deepEqual(out.setup_and_redirect_checks, { setup_verified: true, redirect_verified: true });
  assert.equal(out.finance_enabled_state, "FALSE_BY_OPERATOR_REPORT_AND_UI_CHECK");
  assert.equal(out.finance_exposure, "RESTORED_AND_UI_VERIFIED");
  assert.equal(out.next_gate, "C4_C5_VERIFICATION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("C4 still describes object state only and never proves the app role connection", () => {
  const out = evaluate(REDIRECT_CONFIRMED);
  assert.equal(out.finance_surface_observation.c4_identity_caveat,
    "SQL_EDITOR_IDENTITY_IS_NEONDB_OWNER_NOT_THE_APP_ROLE");
  for (const w of [
    "C4_DESCRIBES_OBJECT_STATE_NOT_THE_APP_ROLE_CONNECTION",
    "C4_REQUIRES_A_SEPARATE_READ_ONLY_APPROVAL_PHRASE",
    "C5_REQUIRES_AN_ACTUAL_APP_ROLE_CONNECTION",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.ok(out.limitations.includes("DOES_NOT_AUTHORIZE_C4_EXECUTION_OR_ANY_SQL"));
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
});


const C4_FAILED = {
  ...structuredClone(REDIRECT_CONFIRMED),
  c4_execution_observation: {
    approval_phrase_received_before_execution: true,
    failed_statement: 1,
    sqlstate: "42P01",
    defect: "MISSING_FROM_CLAUSE",
    valid_results_count: 0,
  },
};

test("the C4 approval arrived before execution but the draft itself was defective", () => {
  const out = evaluate(C4_FAILED);
  assert.equal(out.c4_execution.approval_timing, "C4_APPROVAL_PHRASE_RECEIVED_BEFORE_EXECUTION");
  assert.equal(out.c4_execution.defect, "C4_DRAFT_QUERY1_DEFECT_MISSING_FROM_CLAUSE");
  assert.equal(out.c4_execution.defect_owner, "SESSION_DRAFT_NOT_THE_DATABASE");
  assert.equal(out.c4_execution.transaction_state, "ABORTED_ROLLBACK_REQUIRED");
  assert.equal(out.c4_execution.c4_status, "BLOCKED_ON_DRAFT_CORRECTION");
  assert.equal(out.c4_execution.corrected_draft_version, "v1.1_REQUIRES_SEPARATE_ACKNOWLEDGMENT");
  assert.equal(out.c4_execution.c5_status, "NOT_PERFORMED");
  assert.equal(out.next_gate, "ACKNOWLEDGE_C4_CORRECTION_THEN_RERUN_READ_ONLY");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("SQLSTATE 42P01 is a draft defect and yields no usable C4 findings", () => {
  const out = evaluate(C4_FAILED);
  assert.equal(out.c4_execution.no_valid_results, true);
  assert.equal(out.c4_execution.valid_results_count, 0);
  assert.ok(out.limitations.includes("C4_RESULTS_ARE_NOT_VERIFIED"));
  for (const w of [
    "SQLSTATE_42P01_IS_A_DRAFT_DEFECT_NOT_A_DATABASE_FINDING",
    "NO_VALID_C4_RESULTS_FROM_THE_FAILED_RUN",
    "ABORTED_TRANSACTION_MUST_BE_ROLLED_BACK_BEFORE_RERUN",
    "CORRECTED_TEXT_REQUIRES_A_SEPARATE_ACKNOWLEDGMENT",
    "DO_NOT_INFER_ROLE_OR_RLS_STATE_FROM_A_FAILED_SELECT",
    "DO_NOT_REUSE_RESULTS_OF_THE_ABORTED_TRANSACTION",
    "C4_C5_NOT_PERFORMED",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.finance_exposure, "RESTORED_AND_UI_VERIFIED");
});

test("without the C4 observation the C4/C5 gate stays as previously confirmed", () => {
  const out = evaluate(REDIRECT_CONFIRMED);
  assert.equal(out.c4_execution, null);
  assert.equal(out.next_gate, "C4_C5_VERIFICATION");
});


const C4_RESULTS = {
  ...structuredClone(C4_FAILED),
  c4_results_observation: {
    approval_phrase: "راجعتُ تصحيح C4 v1.1 وأُجيز إعادة تشغيله قراءةً فقط",
    corrected_draft_acknowledged_before_execution: true,
    results_source: "NEON_SQL_EDITOR_AS_NEONDB_OWNER",
    editor_identity: [{
      editor_current_user: "neondb_owner", editor_session_user: "neondb_owner",
      rolsuper: false, rolbypassrls: true, rolcreatedb: true, rolcreaterole: true,
      rolreplication: true, rolcanlogin: true,
    }],
    app_and_admin_roles: [
      { rolname: "selahtone_app", rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false },
      { rolname: "selahtone_finance_admin", rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false },
    ],
    editor_memberships: ["neon_superuser", "pg_read_all_data", "pg_write_all_data", "selahtone_app", "selahtone_finance_admin"].map(role_name => ({ role_name, is_member: true })),
    app_can_connect: [{ app_can_connect: true }],
    rls_state: [
      { nspname: "finance", tables: 18, sequences: 15, rls_enabled: 0, rls_forced: 0 },
      { nspname: "public", tables: 33, sequences: 30, rls_enabled: 0, rls_forced: 0 },
    ],
    policies: null,
    ownership: [{ finance_object_count: 80, owned_by_admin: 80, owned_by_app: 0 }],
    zero_rows: null,
    table_privileges: [
      { qualified_table: "finance.expenses", sel: true, ins: true, del: false, trunc: false },
      { qualified_table: "public.expenses", sel: true, ins: true, del: true, trunc: false },
      { qualified_table: "public.users", sel: true, ins: true, del: true, trunc: false },
    ],
    create_in_finance: [{ create_in_finance: false }],
    triggers_19: null,
    rollback_confirmed: false,
  },
};

test("C4 v1.1 results are partial: eight outputs received, three missing", () => {
  const out = evaluate(C4_RESULTS);
  assert.equal(out.c4_results.approval_timing, "C4_V1_1_ACKNOWLEDGMENT_RECEIVED_BEFORE_EXECUTION");
  assert.equal(out.c4_results.outputs_received_count, 8);
  assert.deepEqual(out.c4_results.missing_outputs, ["policies", "zero_rows", "triggers_19"]);
  assert.equal(out.c4_results.c4_status, "PARTIAL_OBJECT_STATE_ONLY");
  assert.equal(out.c4_results.c5_status, "NOT_PERFORMED");
  assert.equal(out.next_gate, "COMPLETE_C4_MISSING_OUTPUTS_THEN_C5");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("RLS is disabled everywhere so C4 cannot verify RLS enforcement with the app role", () => {
  const out = evaluate(C4_RESULTS);
  assert.equal(out.c4_results.verified_as, "NEONDB_OWNER_NOT_THE_APP_ROLE");
  assert.equal(out.c4_results.rls_enabled_anywhere, "NO_RLS_ENABLED_IN_PUBLIC_OR_FINANCE");
  assert.equal(out.c4_results.rls_enforcement_verified_with_app_role, false);
  assert.equal(out.c4_results.app_role_connection_verified, false);
  assert.equal(out.c4_results.app_can_connect_is, "PRIVILEGE_BIT_FROM_EDITOR_SESSION_NOT_A_LIVE_CONNECTION");
  assert.equal(out.c4_results.triggers_19_verified, false);
  assert.equal(out.c4_results.object_state_verified, true);
  assert.ok(out.limitations.includes("RLS_ENFORCEMENT_WITH_THE_APP_ROLE_IS_NOT_VERIFIED"));
  assert.ok(out.limitations.includes("TRIGGERS_19_ARE_NOT_VERIFIED"));
  for (const w of [
    "RLS_DISABLED_EVERYWHERE_SO_RLS_ENFORCEMENT_WAS_NOT_TESTED",
    "NEONDB_OWNER_BYPASSRLS_TRUE_EDITOR_CANNOT_PROVE_RLS",
    "OWNERSHIP_TRANSFER_DOES_NOT_REMOVE_NEONDB_OWNER_RIGHTS",
    "PARTIAL_RESULT_ONLY_NOT_A_PROOF_OF_C4_SUCCESS",
    "TRIGGERS_19_NOT_RECEIVED",
    "ROLLBACK_NOT_CONFIRMED",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("the editor is also a member of selahtone_app, correcting the earlier claim", () => {
  const out = evaluate(C4_RESULTS);
  assert.equal(out.c4_results.editor_membership_in_selahtone_app, true);
  assert.ok(out.warnings.includes("EDITOR_IS_ALSO_MEMBER_OF_SELAHTONE_APP_PER_PG_HAS_ROLE"));
  assert.ok(out.warnings.includes("PRIOR_CLAIM_OF_NO_SELAHTONE_APP_MEMBERSHIP_IS_CORRECTED"));
  assert.ok(out.warnings.includes("CREATEROLE_AUTO_MEMBERSHIP_POSSIBLE_BUT_NOT_DETERMINED_FROM_THESE_RESULTS"));
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
});

test("only a complete C4 with 19 triggers opens the C5 gate", () => {
  const complete = {
    ...structuredClone(C4_RESULTS),
    c4_results_observation: {
      ...structuredClone(C4_RESULTS.c4_results_observation),
      policies: [],
      zero_rows: [],
      triggers_19: Array.from({ length: 19 }, (_, i) => ({ tgname: `t${i}` })),
      rollback_confirmed: true,
    },
  };
  const out = evaluate(complete);
  assert.equal(out.c4_results.c4_status, "OBJECT_STATE_COMPLETE");
  assert.equal(out.c4_results.triggers_19_verified, true);
  assert.deepEqual(out.c4_results.missing_outputs, []);
  assert.equal(out.next_gate, "C5_ACTUAL_APP_ROLE_CONNECTION");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.c4_results.app_role_connection_verified, false);
});


const C4_UI_MESSAGE_ONLY = {
  ...structuredClone(C4_RESULTS),
  c4_missing_outputs_observation: {
    operator_text: "كلها تعطي Statement executed successfully",
    statements_reported: 3,
    row_outputs_pasted: 0,
    policies_rows: null,
    zero_rows_rows: null,
    triggers_19_rows: null,
    rollback_confirmed: false,
  },
};

test("'Statement executed successfully' is a UI message, not a C4 row result", () => {
  const out = evaluate(C4_UI_MESSAGE_ONLY);
  assert.equal(out.c4_missing_outputs_observation.verdict,
    "STATEMENT_EXECUTED_SUCCESSFULLY_IS_A_UI_MESSAGE_NOT_A_RESULT");
  assert.equal(out.c4_missing_outputs_observation.row_outputs_pasted, 0);
  assert.equal(out.c4_missing_outputs_observation.c4_status,
    "STILL_PARTIAL_NO_ROW_OUTPUTS_RECEIVED");
  assert.equal(out.c4_missing_outputs_observation.absent_paste_is,
    "NOT_EVIDENCE_OF_ZERO_ROWS_OR_OF_19_TRIGGERS");
  assert.equal(out.c4_missing_outputs_observation.rollback_confirmed, false);
  assert.equal(out.next_gate, "PASTE_C4_RESULT_SETS_THEN_C4_C5");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("an absent paste never implies zero rows, empty policies, or 19 triggers", () => {
  const out = evaluate(C4_UI_MESSAGE_ONLY);
  assert.equal(out.c4_missing_outputs_observation.policies_rows, null);
  assert.equal(out.c4_missing_outputs_observation.zero_rows_rows, null);
  assert.equal(out.c4_missing_outputs_observation.triggers_19_rows, null);
  assert.equal(out.c4_results.triggers_19_verified, false);
  assert.equal(out.c4_results.c4_status, "PARTIAL_OBJECT_STATE_ONLY");
  assert.ok(out.limitations.includes("C4_THREE_RESULT_SETS_ARE_NOT_VERIFIED"));
  for (const w of [
    "STATEMENT_EXECUTED_SUCCESSFULLY_IS_NOT_A_ROW_RESULT",
    "STATEMENT_EXECUTED_SUCCESSFULLY_IS_NOT_A_COMMIT_CONFIRMATION",
    "NO_ROW_OUTPUTS_PASTED_FOR_THE_THREE_QUERIES",
    "ABSENCE_OF_PASTED_ROWS_IS_NOT_ZERO_ROWS",
    "TRIGGERS_19_COUNT_NOT_OBSERVED",
    "DO_NOT_INFER_EMPTY_POLICIES_OR_THE_ZERO_ROW_CHECK",
    "ROLLBACK_STILL_NOT_CONFIRMED",
    "C4_STILL_PARTIAL",
    "C5_NOT_PERFORMED",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("C4 remains unverified even after a successful-looking rerun", () => {
  const out = evaluate(C4_UI_MESSAGE_ONLY);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.c4_results.rls_enforcement_verified_with_app_role, false);
  assert.equal(out.c4_results.app_role_connection_verified, false);
  const withoutMessage = structuredClone(C4_RESULTS);
  assert.equal(evaluate(withoutMessage).c4_missing_outputs_observation, null);
});


const C4_REPEATED = {
  ...structuredClone(C4_UI_MESSAGE_ONLY),
  c4_repeated_ui_observation: {
    operator_text: "كلها تعطي Statement executed successfully",
    repeat_count: 2,
    new_row_outputs_pasted: 0,
    new_information: false,
    result_display_capability: "UNKNOWN",
    rollback_confirmed: false,
  },
};

test("a repeated UI message adds no information and must not be re-requested a third time", () => {
  const out = evaluate(C4_REPEATED);
  assert.equal(out.c4_repeated_ui_observation.verdict, "REPEATED_UI_MESSAGE_IS_NOT_A_RESULT");
  assert.equal(out.c4_repeated_ui_observation.new_information, "NO_NEW_INFORMATION_SINCE_SECTION_57");
  assert.equal(out.c4_repeated_ui_observation.do_not_reissue,
    "DO_NOT_REPEAT_THE_SAME_PASTE_REQUEST_A_THIRD_TIME");
  assert.equal(out.c4_repeated_ui_observation.next_clarification,
    "DOES_A_SINGLE_SELECT_SHOW_A_ROW_TABLE_OR_ONLY_THE_MESSAGE");
  assert.equal(out.next_gate, "CLARIFY_RESULT_DISPLAY_THEN_PASTE_C4_OUTPUTS");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the fallback to a local portable probe is a proposal, not an approval", () => {
  const out = evaluate(C4_REPEATED);
  assert.equal(out.c4_repeated_ui_observation.fallback_if_no_display,
    "MOVE_REMAINING_C4_AND_C5_TO_THE_LOCAL_PORTABLE_PROBE_WITH_A_SEPARATE_APPROVAL");
  assert.equal(out.c4_repeated_ui_observation.result_display_capability, "UNKNOWN");
  assert.equal(out.c4_repeated_ui_observation.c4_status, "STILL_PARTIAL_NO_ROW_OUTPUTS_RECEIVED");
  assert.equal(out.c4_repeated_ui_observation.c5_status, "NOT_PERFORMED");
  assert.ok(out.limitations.includes("RESULT_DISPLAY_CAPABILITY_IS_NOT_VERIFIED"));
  for (const w of [
    "REPEATED_UI_MESSAGE_NO_NEW_INFORMATION",
    "NO_PROGRESS_SINCE_SECTION_57",
    "BATCH_EXECUTION_MAY_SHOW_A_GENERIC_MESSAGE_INSTEAD_OF_ROWS",
    "A_GENERIC_UI_MESSAGE_IS_NOT_A_DATABASE_ERROR_OR_ZERO_ROWS",
    "FALLBACK_LOCAL_PROBE_REQUIRES_A_SEPARATE_APPROVAL",
    "C4_STILL_PARTIAL",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("the repeated report changes no earlier C4 finding or release state", () => {
  const out = evaluate(C4_REPEATED);
  assert.equal(out.c4_results.c4_status, "PARTIAL_OBJECT_STATE_ONLY");
  assert.equal(out.c4_results.rls_enforcement_verified_with_app_role, false);
  assert.equal(out.c4_results.triggers_19_verified, false);
  assert.equal(out.c4_missing_outputs_observation.row_outputs_pasted, 0);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.finance_exposure, "RESTORED_AND_UI_VERIFIED");
  assert.equal(evaluate(C4_UI_MESSAGE_ONLY).c4_repeated_ui_observation, null);
});


const C4_CLARIFICATION_ECHO = {
  ...structuredClone(C4_REPEATED),
  c4_clarification_reply: {
    operator_text: "تظهر الرسالة وحدها؟",
    reply_is_question: true,
    confirmed_no_display: null,
    confirmed_table_shown: null,
  },
};

test("an echoed option written as a question is not a confirmed selection", () => {
  const out = evaluate(C4_CLARIFICATION_ECHO);
  assert.equal(out.c4_clarification_reply.verdict, "AMBIGUOUS_ECHO_NOT_A_CONFIRMED_ANSWER");
  assert.equal(out.c4_clarification_reply.confirmed_no_display, null);
  assert.equal(out.c4_clarification_reply.confirmed_table_shown, null);
  assert.equal(out.c4_clarification_reply.result_display_capability, "UNKNOWN");
  assert.deepEqual(out.c4_clarification_reply.confirm_with_one_of, [
    "YES_THE_MESSAGE_APPEARS_ALONE", "NO_A_ROW_TABLE_IS_SHOWN",
  ]);
  assert.equal(out.next_gate, "CONFIRM_ONE_OF_TWO_DISPLAY_OPTIONS");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("both branches are prepared as proposals and neither is executed", () => {
  const out = evaluate(C4_CLARIFICATION_ECHO);
  assert.equal(out.c4_clarification_reply.branch_if_message_only,
    "PROPOSE_LOCAL_PORTABLE_PROBE_WITH_A_SEPARATE_APPROVAL");
  assert.equal(out.c4_clarification_reply.branch_if_table_shown,
    "PASTE_THE_THREE_ROW_COUNTS_AND_CONFIRM_ROLLBACK");
  assert.equal(out.c4_clarification_reply.fallback_draft,
    "NON_EXECUTABLE_PLAN_ONLY_NOT_APPROVED");
  assert.equal(out.c4_clarification_reply.c4_status, "STILL_PARTIAL_NO_ROW_OUTPUTS_RECEIVED");
  assert.equal(out.c4_clarification_reply.c5_status, "NOT_PERFORMED");
  assert.ok(out.limitations.includes("RESULT_DISPLAY_BRANCH_IS_NOT_SELECTED"));
  for (const w of [
    "AMBIGUOUS_ECHO_IS_NOT_A_CONFIRMED_ANSWER",
    "DO_NOT_INFER_THAT_THE_EDITOR_CANNOT_SHOW_RESULTS",
    "DO_NOT_INFER_THAT_ROW_RESULTS_EXIST",
    "ASK_FOR_ONE_OF_TWO_PLAIN_OPTIONS",
    "LOCAL_PROBE_FALLBACK_IS_A_PROPOSAL_ONLY",
    "FALLBACK_LOCAL_PROBE_REQUIRES_A_SEPARATE_APPROVAL",
    "NO_NEW_EXECUTION_OR_SQL_FROM_THIS_REPLY",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("the ambiguous echo changes no C4 finding and never opens a deploy gate", () => {
  const out = evaluate(C4_CLARIFICATION_ECHO);
  assert.equal(out.c4_results.c4_status, "PARTIAL_OBJECT_STATE_ONLY");
  assert.equal(out.c4_results.rls_enforcement_verified_with_app_role, false);
  assert.equal(out.c4_results.triggers_19_verified, false);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.deploy_gate, "OPEN_ENV_VAR_ONLY");
  assert.equal(out.finance_exposure, "RESTORED_AND_UI_VERIFIED");
  assert.equal(evaluate(C4_REPEATED).c4_clarification_reply, null);
});


const C5_SELECTED = {
  ...structuredClone(C4_CLARIFICATION_ECHO),
  c5_path_selection: {
    selected_option: "YES_THE_MESSAGE_APPEARS_ALONE",
    confirmed_by_operator: true,
    sql_editor_result_display: "MESSAGE_ONLY_NO_ROWS",
    separate_approval_received: false,
    draft_prepared: "c5-local-probe-REVIEW-DRAFT-NOT-EXECUTABLE.md",
  },
};

test("selecting the local-probe branch prepares a review draft, not an execution", () => {
  const out = evaluate(C5_SELECTED);
  assert.equal(out.c5_path_selection.verdict, "SQL_EDITOR_CANNOT_SUPPLY_C4_RESULTS");
  assert.equal(out.c5_path_selection.branch, "LOCAL_PORTABLE_PROBE_AS_SELAHTONE_APP");
  assert.equal(out.c5_path_selection.draft_is, "REVIEW_ONLY_NOT_EXECUTABLE_NOT_APPROVED");
  assert.equal(out.c5_path_selection.separate_approval_received, false);
  assert.equal(out.c5_path_selection.c5_status, "DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED");
  assert.equal(out.c5_path_selection.post_run_check_status, "NOT_PERFORMED");
  assert.equal(out.next_gate, "REVIEW_C5_LOCAL_PROBE_TEXT_THEN_SEPARATE_APPROVAL");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("C5 must not change credentials, the pinned sha, or the deployed app identity", () => {
  const out = evaluate(C5_SELECTED);
  assert.equal(out.c5_path_selection.pinned_probe_sha,
    "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb");
  assert.equal(out.c5_path_selection.no_new_password, true);
  assert.equal(out.c5_path_selection.pooled_url_only, true);
  assert.equal(out.c5_path_selection.secrets_sent_to_chat, false);
  assert.equal(out.c5_path_selection.local_connection_is,
    "NOT_PROOF_OF_THE_DEPLOYED_APP_IDENTITY");
  assert.equal(out.c5_path_selection.database_url_switch, "UNVERIFIED_FROM_LOG");
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.ok(out.limitations.includes("C5_LOCAL_PROBE_TEXT_IS_NOT_APPROVED"));
  for (const w of [
    "C5_REQUIRES_A_SEPARATE_EXPLICIT_APPROVAL_PHRASE",
    "PINNED_PROBE_SHA_MUST_REMAIN_UNCHANGED",
    "DO_NOT_SEND_DATABASE_URL_OR_PASSWORD_TO_THE_CHAT",
    "NO_NEW_PASSWORD_AND_NO_NEONDB_OWNER_ROTATION",
    "POOLED_CONNECTION_ONLY_REVERT_TO_OLD_URL_ON_ERROR",
    "RLS_DISABLED_SO_RLS_ENFORCEMENT_REMAINS_UNVERIFIABLE",
    "DO_NOT_REENABLE_FINANCE_OR_RUN_ANY_FINANCIAL_ACTION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("only the explicit separate approval opens the local run gate", () => {
  const approved = {
    ...structuredClone(C5_SELECTED),
    c5_path_selection: { ...structuredClone(C5_SELECTED.c5_path_selection), separate_approval_received: true },
  };
  const out = evaluate(approved);
  assert.equal(out.next_gate, "RUN_LOCAL_PROBE_THEN_OFFLINE_EVALUATION");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.c5_path_selection.separate_approval_received, true);
  assert.equal(evaluate(C4_CLARIFICATION_ECHO).c5_path_selection, null);
});


const C5_TRUNCATED_APPROVAL = {
  ...structuredClone(C5_SELECTED),
  c5_approval_attempt: {
    phrase_received: "راجعتُ نص فحص C5 المحلي وخطة الرجوع، وأُجيز تشغيله قراءةً فقط من اتصال دور selahtone_app، دون نشر أو إعادة تفعي",
    received_before_execution: true,
    verbatim_match: false,
    missing_suffix: "ل",
    expected_ending: "دون نشر أو إعادة تفعيل",
    separate_approval_received: false,
  },
};

test("a truncated approval phrase arrives early but opens no gate", () => {
  const out = evaluate(C5_TRUNCATED_APPROVAL);
  assert.equal(out.c5_approval_attempt.timing,
    "C5_APPROVAL_ATTEMPT_RECEIVED_BEFORE_EXECUTION");
  assert.equal(out.c5_approval_attempt.verdict, "TRUNCATED_APPROVAL_PHRASE_NOT_VERBATIM");
  assert.equal(out.c5_approval_attempt.verbatim_match, false);
  assert.equal(out.c5_approval_attempt.gate_opened, false);
  assert.equal(out.c5_approval_attempt.command_sent, false);
  assert.equal(out.c5_approval_attempt.required_action, "RESEND_THE_COMPLETE_PHRASE_VERBATIM");
  assert.equal(out.next_gate, "RESEND_COMPLETE_C5_APPROVAL_PHRASE");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("a near-match never authorizes the local probe command", () => {
  const out = evaluate(C5_TRUNCATED_APPROVAL);
  assert.equal(out.c5_path_selection.separate_approval_received, false);
  assert.equal(out.c5_path_selection.c5_status, "DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED");
  assert.equal(out.c5_approval_attempt.c5_status, "DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED");
  assert.equal(out.c5_approval_attempt.missing_suffix, "ل");
  assert.ok(out.limitations.includes("C5_APPROVAL_PHRASE_IS_NOT_VERIFIED"));
  assert.equal(out.c5_approval_attempt.strict_reject_message,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  for (const w of [
    "TRUNCATED_APPROVAL_PHRASE_IS_NOT_A_VERBATIM_MATCH",
    "NO_GATE_OPENED_AND_NO_COMMAND_SENT",
    "RESEND_THE_COMPLETE_PHRASE_VERBATIM",
    "DO_NOT_EXECUTE_OR_SEND_ANY_COMMAND_BEFORE_THE_EXACT_PHRASE",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("the flat next_gate resolver preserves every earlier gate", () => {
  assert.equal(evaluate(C5_SELECTED).next_gate,
    "REVIEW_C5_LOCAL_PROBE_TEXT_THEN_SEPARATE_APPROVAL");
  assert.equal(evaluate(C4_CLARIFICATION_ECHO).next_gate,
    "CONFIRM_ONE_OF_TWO_DISPLAY_OPTIONS");
  assert.equal(evaluate(C4_REPEATED).next_gate,
    "CLARIFY_RESULT_DISPLAY_THEN_PASTE_C4_OUTPUTS");
  assert.equal(evaluate(C4_UI_MESSAGE_ONLY).next_gate,
    "PASTE_C4_RESULT_SETS_THEN_C4_C5");
  assert.equal(evaluate(C4_RESULTS).next_gate,
    "COMPLETE_C4_MISSING_OUTPUTS_THEN_C5");
  assert.equal(evaluate(C4_FAILED).next_gate,
    "ACKNOWLEDGE_C4_CORRECTION_THEN_RERUN_READ_ONLY");
  assert.equal(evaluate(REDIRECT_CONFIRMED).next_gate, "C4_C5_VERIFICATION");
  assert.equal(evaluate(AMBIGUOUS_SURFACE).next_gate,
    "DISAMBIGUATE_FINANCE_REDIRECT_THEN_C4_C5");
  assert.equal(evaluate(C5_SELECTED).c5_approval_attempt, null);
});


const C5_APPROVED = {
  ...structuredClone(C5_TRUNCATED_APPROVAL),
  c5_path_selection: {
    ...structuredClone(C5_TRUNCATED_APPROVAL.c5_path_selection),
    separate_approval_received: true,
  },
  c5_approval_confirmed: {
    phrase_received: "راجعتُ نص فحص C5 المحلي وخطة الرجوع، وأُجيز تشغيله قراءةً فقط من اتصال دور selahtone_app، دون نشر أو إعادة تفعيل.",
    verbatim_match: true,
    received_before_execution: true,
    command_delivered_in_chat: true,
    secrets_in_command: false,
    executed_by_session: false,
    probe_sha_pinned: "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb",
  },
};

test("the verbatim approval opens the local run gate", () => {
  const out = evaluate(C5_APPROVED);
  assert.equal(out.c5_approval_confirmed.verdict,
    "C5_APPROVAL_PHRASE_VERBATIM_BEFORE_EXECUTION");
  assert.equal(out.c5_approval_confirmed.command_delivered_in_chat, true);
  assert.equal(out.c5_approval_confirmed.secrets_in_command, false);
  assert.equal(out.c5_approval_confirmed.executed_by_session, false);
  assert.equal(out.c5_approval_confirmed.reenable_gate, "CLOSED");
  assert.equal(out.c5_approval_confirmed.c5_status,
    "COMMAND_DELIVERED_AWAITING_OPERATOR_RESULTS");
  assert.equal(out.next_gate, "RUN_LOCAL_PROBE_THEN_OFFLINE_EVALUATION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("delivering the command is not executing it and does not verify results", () => {
  const out = evaluate(C5_APPROVED);
  assert.equal(out.c5_approval_confirmed.post_run_check_status, "NOT_PERFORMED");
  assert.ok(out.limitations.includes("C5_RESULTS_ARE_NOT_YET_RECEIVED_OR_VERIFIED"));
  for (const w of [
    "COMMAND_DELIVERED_IN_CHAT_NOT_EXECUTED_BY_SESSION",
    "NO_SECRETS_IN_THE_COMMAND",
    "POOLED_URL_ONLY_REVERT_TO_OLD_URL_ON_CONNECTION_ERROR",
    "RESULTS_REQUIRE_OFFLINE_EVALUATION_BEFORE_ANY_DECISION",
    "DO_NOT_REENABLE_FINANCE_OR_RUN_ANY_FINANCIAL_ACTION",
    "POST_RUN_CHECK_STILL_REQUIRED",
    "C5_NOT_PERFORMED",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
});

test("the confirmed approval supersedes the earlier truncated attempt", () => {
  const out = evaluate(C5_APPROVED);
  assert.equal(out.c5_approval_attempt.verdict, "TRUNCATED_APPROVAL_PHRASE_NOT_VERBATIM");
  assert.equal(out.c5_approval_confirmed.verbatim_match, true);
  assert.equal(out.next_gate, "RUN_LOCAL_PROBE_THEN_OFFLINE_EVALUATION");
  assert.equal(evaluate(C5_TRUNCATED_APPROVAL).next_gate,
    "RESEND_COMPLETE_C5_APPROVAL_PHRASE");
  assert.equal(evaluate(C5_SELECTED).c5_approval_confirmed, null);
});


const C5_RESULTS = {
  ...structuredClone(C5_APPROVED),
  c5_results_observation: {
    received_from: "LOCAL_MAC_TERMINAL_C5_STANDALONE_TOOL",
    pinned_probe_sha: "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb",
    c4_sql_sha: "ec6926aa0397e236a31db710706b75749fd4d291375c80c33b6fa0cab748083d",
    probe_scope: "C5_LOCAL_PROBE_PLUS_C4_COMPLETION",
    current_user: "selahtone_app", session_user: "selahtone_app",
    read_only_transaction: true, c4_read_only_rollback: true,
    role_flags: { inherit: true, can_login: true, superuser: false, create_db: false, create_role: false, replication: false, bypass_rls: false },
    inherited_roles: [], inherits_read_all_data: false, inherits_write_all_data: false,
    can_create_schema: false, can_create_in_finance: false,
    finance_schema_owned_by_current_user: false, finance_object_count: 18,
    finance_objects_all: { can_select: true, can_insert: true, can_update: true, can_delete: false, can_truncate: false, rls_active: false, owned_by_current_user: false },
    c4_counts: { policies: 0, zero_rows: 0, triggers_19: 0 },
    ssl_warning_non_blocking: true,
    tool_limitations: ["ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP"],
    secrets_in_output: false,
  },
};

test("the live pooled probe verifies the app role identity and privilege shape", () => {
  const out = evaluate(C5_RESULTS);
  assert.equal(out.c5_results.identity_verified_as, "SELAHTONE_APP_LIVE_POOLED_CONNECTION");
  assert.equal(out.c5_results.privileges_match_expected_shape, true);
  assert.equal(out.c5_results.c4_counts_match, true);
  assert.equal(out.c5_results.c4_read_only_rollback, true);
  assert.equal(out.c5_results.secrets_in_output, false);
  assert.equal(out.c5_results.c5_status, "LOCAL_PROBE_COMPLETE_NOT_A_DEPLOY_PROOF");
  assert.equal(out.next_gate, "POST_RUN_CHECK_THEN_SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("zero production triggers is a scope correction, not a probe failure", () => {
  const out = evaluate(C5_RESULTS);
  assert.deepEqual(out.c5_results.c4_counts, { policies: 0, zero_rows: 0, triggers_19: 0 });
  assert.equal(out.c5_results.triggers_19, "ZERO_IN_PRODUCTION_FINANCE_SCHEMA");
  assert.equal(out.c5_results.triggers_scope_correction,
    "TRIGGERS_19_ARE_LAB_ONLY_FINANCE_LAB_NOT_PRODUCTION");
  assert.equal(out.c5_results.zero_triggers_is,
    "OBSERVATION_NOT_A_PROBE_FAILURE_AND_NOT_A_TRIGGER_TEST");
  assert.equal(out.c5_results.rls_enforcement_verified_with_app_role, false);
  assert.equal(out.c5_results.ssl_warning, "NON_BLOCKING_PG_SSLMODE_DEPRECATION_WARNING");
  for (const w of [
    "TRIGGERS_19_ARE_LAB_ONLY_FINANCE_LAB_NOT_PRODUCTION",
    "PRIOR_19_PRODUCTION_TRIGGER_ASSUMPTION_IS_CORRECTED",
    "ZERO_PRODUCTION_TRIGGERS_IS_NOT_A_TRIGGER_ENFORCEMENT_TEST",
    "RLS_DISABLED_AND_ZERO_POLICIES_SO_RLS_ENFORCEMENT_UNVERIFIABLE",
    "SSL_WARNING_IS_NON_BLOCKING_NO_SSLMODE_CHANGE_REQUESTED",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("a local app-role connection never proves the deployed app identity", () => {
  const out = evaluate(C5_RESULTS);
  assert.equal(out.c5_results.local_connection_is, "NOT_PROOF_OF_THE_DEPLOYED_APP_IDENTITY");
  assert.equal(out.c5_results.deployed_app_identity,
    "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.c5_results.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.c5_results.database_url_switch, "UNVERIFIED_FROM_LOG");
  assert.equal(out.c5_results.post_run_check_status, "NOT_PERFORMED");
  assert.equal(out.c5_results.reenable_gate, "CLOSED");
  assert.ok(out.warnings.includes("DO_NOT_REENABLE_FINANCE_OR_RUN_ANY_FINANCIAL_ACTION"));
  assert.ok(!out.warnings.includes("C5_NOT_PERFORMED"));
  assert.ok(out.limitations.includes("RLS_AND_TRIGGER_ENFORCEMENT_ARE_NOT_VERIFIED"));
  assert.equal(evaluate(C5_APPROVED).c5_results, null);
});


const POST_RUN_PARTIAL = {
  ...structuredClone(C5_RESULTS),
  post_run_observation: {
    operator_text: "لا يظهر خطا",
    scope: "LOG_OBSERVATION_ONLY",
    errors_in_log_absent: true,
    setup_rechecked_after_env_change: null,
    finance_redirect_rechecked_after_env_change: null,
    first_write_or_financial_action_performed: false,
    database_url_switch_verified: null,
    log_timestamps_present: null,
    log_year_present: null,
  },
};

test("'no error appears' is a log observation, not a connectivity proof", () => {
  const out = evaluate(POST_RUN_PARTIAL);
  assert.equal(out.post_run_check.verdict, "NO_ERROR_IN_LOG_IS_NOT_A_CONNECTIVITY_PROOF");
  assert.equal(out.post_run_check.errors_in_log_absent, true);
  assert.equal(out.post_run_check.absence_of_errors_is,
    "NOT_A_PROOF_OF_THE_DEPLOYED_APP_ROLE_OR_OF_RLS");
  assert.equal(out.post_run_check.finance_is_disabled_so,
    "NO_WRITE_OCCURRED_ERRORS_MAY_APPEAR_ONLY_ON_FIRST_WRITE");
  assert.equal(out.post_run_check.first_write_or_financial_action_performed, false);
  assert.equal(out.post_run_check.post_run_check_status, "PARTIAL_LOG_OBSERVATION_ONLY");
  assert.equal(out.next_gate, "COMPLETE_POST_RUN_CHECK_THEN_SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the partial post-run check leaves the re-enable gate closed", () => {
  const out = evaluate(POST_RUN_PARTIAL);
  assert.equal(out.post_run_check.setup_rechecked_after_env_change, null);
  assert.equal(out.post_run_check.finance_redirect_rechecked_after_env_change, null);
  assert.equal(out.post_run_check.database_url_switch_verified, null);
  assert.equal(out.post_run_check.deployed_app_identity,
    "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.post_run_check.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.post_run_check.reenable_gate, "CLOSED");
  assert.ok(out.limitations.includes("POST_RUN_UI_AND_ENV_CHANGE_ARE_NOT_VERIFIED"));
  for (const w of [
    "NO_ERROR_IN_LOG_IS_NOT_A_CONNECTIVITY_PROOF",
    "ABSENCE_OF_ERRORS_DOES_NOT_PROVE_THE_NEW_ROLE_IS_USED",
    "FINANCE_IS_DISABLED_SO_NO_FINANCIAL_WRITE_OCCURRED",
    "ERRORS_MAY_APPEAR_ONLY_ON_FIRST_WRITE",
    "POST_RUN_CHECK_IS_PARTIAL_LOG_OBSERVATION_ONLY",
    "SETUP_AND_REDIRECT_RECHECK_NOT_REPORTED",
    "DATABASE_URL_SWITCH_NOT_VERIFIED_BY_THIS_OBSERVATION",
    "LOG_YEAR_AND_TIMESTAMPS_STILL_MISSING",
    "DO_NOT_REENABLE_FINANCE_OR_RUN_ANY_FINANCIAL_ACTION",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("only a complete post-run check opens the separate re-enable decision", () => {
  const complete = {
    ...structuredClone(POST_RUN_PARTIAL),
    post_run_observation: {
      ...structuredClone(POST_RUN_PARTIAL.post_run_observation),
      setup_rechecked_after_env_change: true,
      finance_redirect_rechecked_after_env_change: true,
      database_url_switch_verified: true,
    },
  };
  const out = evaluate(complete);
  assert.equal(out.post_run_check.post_run_check_status, "COMPLETE");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
  assert.equal(out.post_run_check.reenable_gate, "CLOSED");
  assert.equal(evaluate(C5_RESULTS).post_run_check, null);
});


const POST_RUN_COMPLETE_REPORT = {
  ...structuredClone(POST_RUN_PARTIAL),
  post_run_observation: {
    operator_text: "ما زال يظهر «معطّلة مرحليًا»، و /finance ما زال يُحوّل إلى /dashboard، تأكَّد ضبط DATABASE_URL",
    scope: "POST_RUN_UI_AND_ENV_OPERATOR_REPORT",
    errors_in_log_absent: true,
    setup_rechecked_after_env_change: true,
    finance_redirect_rechecked_after_env_change: true,
    setup_message_still_shown: true,
    finance_redirect_still_to_dashboard: true,
    database_url_switch_confirmed_by_operator: true,
    database_url_switch_verified: true,
    database_url_value_shared: false,
    verification_basis: "OPERATOR_REPORT_NOT_LOG_PROVENANCE",
    database_url_switch_from_log: "UNVERIFIED_FROM_LOG",
    live_app_database_request_observed: false,
    first_write_or_financial_action_performed: false,
    log_timestamps_present: null,
    log_year_present: null,
  },
};

test("the full post-run report completes the UI checks but is an operator report", () => {
  const out = evaluate(POST_RUN_COMPLETE_REPORT);
  assert.equal(out.post_run_check.verdict,
    "POST_RUN_CHECK_COMPLETE_OPERATOR_REPORT_ONLY_NOT_A_CONNECTIVITY_PROOF");
  assert.equal(out.post_run_check.setup_message_still_shown, true);
  assert.equal(out.post_run_check.finance_redirect_still_to_dashboard, true);
  assert.equal(out.post_run_check.database_url_switch_confirmed_by_operator, true);
  assert.equal(out.post_run_check.database_url_value_shared, false);
  assert.equal(out.post_run_check.verification_basis, "OPERATOR_REPORT_NOT_LOG_PROVENANCE");
  assert.equal(out.post_run_check.database_url_switch_from_log, "UNVERIFIED_FROM_LOG");
  assert.equal(out.post_run_check.post_run_check_status, "COMPLETE");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("a completed UI check never proves the deployed app role or RLS", () => {
  const out = evaluate(POST_RUN_COMPLETE_REPORT);
  assert.equal(out.post_run_check.live_app_database_request_observed, false);
  assert.equal(out.post_run_check.ui_checks_are,
    "NOT_A_CONNECTIVITY_PROOF_FINANCE_IS_DISABLED");
  assert.equal(out.post_run_check.deployed_app_role_identity,
    "UNVERIFIED_NO_LIVE_APP_DB_REQUEST_OBSERVED");
  assert.equal(out.post_run_check.deployed_app_identity,
    "DATABASE_URL_REPORTED_SET_BUT_LIVE_APP_ROLE_STILL_UNVERIFIED");
  assert.equal(out.post_run_check.rls_and_trigger_enforcement,
    "UNVERIFIED_RLS_DISABLED_AND_ZERO_PRODUCTION_TRIGGERS");
  assert.equal(out.post_run_check.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.post_run_check.first_write_or_financial_action_performed, false);
  assert.ok(out.limitations.includes("DEPLOYED_APP_ROLE_IDENTITY_IS_NOT_VERIFIED"));
  assert.ok(out.limitations.includes("FINANCE_DISABLED_UI_CHECKS_ARE_NOT_A_CONNECTIVITY_PROOF"));
});

test("the separate re-enable decision is not solicited and the gate stays closed", () => {
  const out = evaluate(POST_RUN_COMPLETE_REPORT);
  assert.equal(out.post_run_check.reenable_decision_solicited, false);
  assert.equal(out.post_run_check.reenable_gate, "CLOSED");
  for (const b of [
    "DEPLOYED_APP_ROLE_IDENTITY_IS_UNVERIFIED",
    "RLS_ENFORCEMENT_WITH_THE_APP_ROLE_IS_UNVERIFIED",
    "ATOMIC_ACCESS_CONTROL_GAP",
    "PRISMAPG_6_19_3_COMMIT_FAILURE_GAP",
    "RENDER_YAML_TRUE_WITHOUT_SYNC_FALSE",
  ]) assert.ok(out.post_run_check.blockers_remaining.includes(b), b);
  for (const w of [
    "SETUP_AND_REDIRECT_RECHECKED_AFTER_ENV_CHANGE",
    "DATABASE_URL_SWITCH_CONFIRMED_BY_OPERATOR_ONLY",
    "DATABASE_URL_SWITCH_STILL_UNVERIFIED_FROM_LOG",
    "DATABASE_URL_VALUE_NOT_SHARED",
    "UI_CHECKS_WITH_FINANCE_DISABLED_ARE_NOT_A_CONNECTIVITY_PROOF",
    "NO_LIVE_APP_DATABASE_REQUEST_OBSERVED",
    "REENABLE_DECISION_IS_SEPARATE_AND_NOT_YET_GIVEN",
    "REENABLE_DECISION_NOT_SOLICITED_DO_NOT_SET_FINANCE_ENABLED_TRUE",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.ok(!out.warnings.includes("POST_RUN_CHECK_IS_PARTIAL_LOG_OBSERVATION_ONLY"));
  assert.ok(!out.warnings.includes("SETUP_AND_REDIRECT_RECHECK_NOT_REPORTED"));
  assert.equal(evaluate(POST_RUN_PARTIAL).next_gate,
    "COMPLETE_POST_RUN_CHECK_THEN_SEPARATE_REENABLE_DECISION");
});


const NEXT_STEP_QUESTION = {
  ...structuredClone(POST_RUN_COMPLETE_REPORT),
  next_step_question: {
    operator_text: "ما الخطوه التاليه ؟",
    kind: "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    received_in_chat: true,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_approval_phrase_solicited: true,
    no_secrets_requested: true,
  },
};

test("asking for the next step is a procedural question, not an approval", () => {
  const out = evaluate(NEXT_STEP_QUESTION);
  assert.equal(out.next_step.kind, "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL");
  assert.equal(out.next_step.answer_delivered_in_chat, true);
  assert.equal(out.next_step.no_file_reference, true);
  assert.equal(out.next_step.no_approval_phrase_solicited, true);
  assert.equal(out.next_step.no_secrets_requested, true);
  assert.equal(out.next_step.current_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.next_step.gate_status, "CLOSED_NOT_READY");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the next step is an operator choice, with hold as the default", () => {
  const out = evaluate(NEXT_STEP_QUESTION);
  assert.equal(out.next_step.immediate_next_step,
    "OPERATOR_CHOOSES_HOLD_OR_A_SEPARATE_OFFLINE_ANALYSIS_SCOPE");
  assert.equal(out.next_step.default_if_unanswered,
    "HOLD_FINANCE_DISABLED_NO_ACTION_FROM_THE_SESSION");
  assert.equal(out.next_step.option_1, "HOLD_FINANCE_ENABLED_FALSE_AND_STOP_HERE");
  assert.equal(out.next_step.option_2,
    "AUTHORIZE_A_SEPARATE_OFFLINE_ANALYSIS_SCOPE_FOR_THE_REMAINING_BLOCKERS");
  assert.equal(out.next_step.option_2_limits,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_TRUE");
  for (const w of [
    "PROCEDURAL_QUESTION_IS_NOT_A_DECISION_OR_AN_APPROVAL",
    "THE_NEXT_STEP_IS_AN_OPERATOR_CHOICE_NOT_AN_EXECUTION",
    "REENABLE_DECISION_NOT_SOLICITED_DO_NOT_SET_FINANCE_ENABLED_TRUE",
    "NO_COMMAND_NO_SQL_NO_DEPLOY_NO_SYNC_NO_SRC_CHANGES",
    "NO_SECRETS_OR_ROWS_REQUESTED_IN_THE_CHAT",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.ok(out.limitations.includes(
    "REMAINING_BLOCKERS_ARE_NOT_RESOLVED_BY_ASKING_FOR_THE_NEXT_STEP"));
});

test("the question neither opens the re-enable gate nor changes earlier findings", () => {
  const out = evaluate(NEXT_STEP_QUESTION);
  assert.equal(out.next_step.reenable_decision_solicited, false);
  assert.equal(out.next_step.reenable_gate, "CLOSED");
  assert.equal(out.post_run_check.post_run_check_status, "COMPLETE");
  assert.equal(out.c5_results.identity_verified_as, "SELAHTONE_APP_LIVE_POOLED_CONNECTION");
  assert.equal(out.c5_results.deployed_app_identity,
    "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.deployed_app_identity, "STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(POST_RUN_COMPLETE_REPORT).next_step, null);
});


const REENABLE_REQUEST = {
  ...structuredClone(NEXT_STEP_QUESTION),
  reenable_request: {
    operator_text: "انا اريد تشغيل و انهاء المهمه كلها",
    kind: "REENABLE_REQUEST_BROAD_INTENT_NOT_A_SEPARATE_VERBATIM_DECISION",
    received_in_chat: true,
    verbatim_reenable_decision: false,
    gate_opened: false,
    command_sent: false,
    any_action_taken_by_session: false,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_approval_phrase_solicited: true,
    no_secrets_requested: true,
  },
};

test("a broad intent to enable and finish is refused, not a separate decision", () => {
  const out = evaluate(REENABLE_REQUEST);
  assert.equal(out.reenable_request.kind,
    "REENABLE_REQUEST_BROAD_INTENT_NOT_A_SEPARATE_VERBATIM_DECISION");
  assert.equal(out.reenable_request.verdict, "REENABLE_REQUEST_REFUSED_NOT_READY");
  assert.equal(out.reenable_request.verbatim_reenable_decision, false);
  assert.equal(out.reenable_request.gate_opened, false);
  assert.equal(out.reenable_request.command_sent, false);
  assert.equal(out.reenable_request.any_action_taken_by_session, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the refusal keeps every no-action boundary and the strict-reject policy", () => {
  const out = evaluate(REENABLE_REQUEST);
  assert.equal(out.reenable_request.gate_status, "CLOSED_NOT_READY");
  assert.equal(out.reenable_request.reenable_gate, "CLOSED");
  assert.equal(out.reenable_request.reenable_decision_solicited, false);
  assert.equal(out.reenable_request.no_approval_phrase_solicited, true);
  assert.equal(out.reenable_request.no_secrets_requested, true);
  assert.equal(out.reenable_request.strict_reject_policy, "IN_FORCE");
  assert.equal(out.reenable_request.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.match(out.reenable_request.no_action_scope, /NO_TRUE/);
  assert.match(out.reenable_request.no_action_scope, /NO_DEPLOY/);
  for (const w of [
    "REENABLE_REQUEST_IS_NOT_A_SEPARATE_EXPLICIT_DECISION",
    "REENABLE_GATE_CLOSED_NOT_READY",
    "DO_NOT_SET_FINANCE_ENABLED_TRUE",
    "NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT",
    "NO_PRODUCTION_SQL_NO_SRC_NO_RENDER_YAML_CHANGES",
    "NO_FINANCIAL_ACTION_OR_WRITE_OR_REFUND_TEST",
    "DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("the refusal lists the unresolved blockers and changes no earlier finding", () => {
  const out = evaluate(REENABLE_REQUEST);
  for (const b of [
    "SEPARATE_EXPLICIT_REENABLE_DECISION_NOT_RECEIVED",
    "IDENTITY_GAP_CONFIRMED",
    "DEPLOYED_APP_ROLE_IDENTITY_IS_UNVERIFIED",
    "RLS_AND_TRIGGER_ENFORCEMENT_ARE_UNVERIFIED",
    "ATOMIC_ACCESS_CONTROL_GAP",
    "PRISMAPG_6_19_3_COMMIT_FAILURE_GAP",
    "C1_C2_FAIL",
  ]) assert.ok(out.reenable_request.reason_codes.includes(b), b);
  assert.equal(out.reenable_request.immediate_next_step,
    "CHOOSE_HOLD_OR_A_SEPARATE_OFFLINE_ANALYSIS_SCOPE");
  assert.equal(out.reenable_request.default_if_unanswered,
    "HOLD_FINANCE_DISABLED_NO_ACTION_FROM_THE_SESSION");
  assert.ok(out.limitations.includes("REENABLE_DECISION_IS_NOT_VERIFIED"));
  assert.equal(out.post_run_check.post_run_check_status, "COMPLETE");
  assert.equal(out.c5_results.identity_verified_as, "SELAHTONE_APP_LIVE_POOLED_CONNECTION");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(NEXT_STEP_QUESTION).reenable_request, null);
});


const GATE_PLAN_QUESTION = {
  ...structuredClone(REENABLE_REQUEST),
  gate_planning_question: {
    operator_text: "وكيف نفتح البوابات و نكون جاهزين للنشر",
    kind: "PROCEDURAL_GATE_PLANNING_QUESTION_NOT_AN_APPROVAL",
    received_in_chat: true,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_approval_phrase_solicited: true,
    no_secrets_requested: true,
    gate_opened: false,
    command_sent: false,
    any_action_taken_by_session: false,
  },
};

test("asking how to open the gates delivers a roadmap, not an authorization", () => {
  const out = evaluate(GATE_PLAN_QUESTION);
  assert.equal(out.gate_plan.kind,
    "PROCEDURAL_GATE_PLANNING_QUESTION_NOT_AN_APPROVAL");
  assert.equal(out.gate_plan.verdict,
    "ROADMAP_DELIVERED_IN_CHAT_NOT_A_GATE_AND_NOT_AN_AUTHORIZATION");
  assert.equal(out.gate_plan.gate_opened, false);
  assert.equal(out.gate_plan.command_sent, false);
  assert.equal(out.gate_plan.any_action_taken_by_session, false);
  assert.equal(out.gate_plan.no_approval_phrase_solicited, true);
  assert.equal(out.gate_plan.no_secrets_requested, true);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the fixed order is preserved and the final gate is a separate decision", () => {
  const out = evaluate(GATE_PLAN_QUESTION);
  assert.deepEqual(out.gate_plan.fixed_order, [
    "READ_ONLY_CHECK", "OFFLINE_EVALUATION", "REVIEWED_SQL_TEXT",
    "SEPARATE_EXPLICIT_SQL_APPROVAL", "ROLLBACK_PLAN", "SEPARATE_DEPLOY_APPROVAL",
    "SET_THE_ENV_VAR_VALUE_ONLY", "C4", "C5", "POST_RUN_CHECK",
    "SEPARATE_EXPLICIT_REENABLE_DECISION",
  ]);
  assert.equal(out.gate_plan.no_blanket_approval, true);
  assert.equal(out.gate_plan.each_gate_requires,
    "SEPARATE_REVIEW_TEXT_THEN_SEPARATE_EXPLICIT_APPROVAL_THEN_ROLLBACK_PLAN");
  assert.equal(out.gate_plan.gate_status, "CLOSED_NOT_READY");
  assert.equal(out.gate_plan.reenable_gate, "CLOSED");
  assert.equal(out.gate_plan.reenable_decision_solicited, false);
  assert.ok(out.limitations.includes("ROADMAP_DOES_NOT_VERIFY_ANY_GATE_OR_ANY_RESULT"));
});

test("the roadmap names every remaining blocker without opening any", () => {
  const out = evaluate(GATE_PLAN_QUESTION);
  for (const g of [
    "DEPLOYED_APP_ROLE_IDENTITY_READ_ONLY_PROOF",
    "RLS_AND_TRIGGER_ENFORCEMENT_TESTED_WITH_THE_APP_ROLE",
    "ATOMIC_ACCESS_CONTROL_GAP_RESOLVED",
    "PRISMAPG_6_19_3_COMMIT_FAILURE_LIFECYCLE_RESOLVED",
    "ROLLED_BACK_REHEARSED_RELEASE_CANDIDATE_VERSION",
    "CASH_MOVEMENT_TIMING_AND_HUMAN_REVIEW_EVIDENCE",
    "CONVERSION_WINDOW_DEFINED",
    "LOG_YEAR_TIMESTAMPS_AND_OPERATOR_DECISIONS_SUPPLIED",
    "RENDER_YAML_TRUE_WITHOUT_SYNC_FALSE_RECONCILED",
  ]) assert.ok(out.gate_plan.gates_to_open_before_readiness.includes(g), g);
  assert.equal(out.gate_plan.gates_to_open_before_readiness.length, 9);
  assert.equal(out.gate_plan.no_scope_change,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE");
  assert.equal(out.gate_plan.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  for (const w of [
    "ROADMAP_DELIVERED_IN_CHAT_OPENS_NO_GATE",
    "NO_BLANKET_APPROVAL_FOR_THE_WHOLE_RELEASE",
    "DO_NOT_SET_FINANCE_ENABLED_TRUE",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.post_run_check.post_run_check_status, "COMPLETE");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(REENABLE_REQUEST).gate_plan, null);
});


const READINESS_REQUIREMENTS_QUESTION = {
  ...structuredClone(GATE_PLAN_QUESTION),
  readiness_requirements_question: {
    operator_text: "ما المطلوب مني لاكمال الجاهزيه",
    kind: "PROCEDURAL_REQUIREMENTS_QUESTION_NOT_AN_APPROVAL_OR_AUTHORIZATION",
    received_in_chat: true,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_approval_phrase_solicited: true,
    no_secrets_requested: true,
    gate_opened: false,
    command_sent: false,
    any_action_taken_by_session: false,
  },
};

test("asking what is required lists requirements without opening a gate", () => {
  const out = evaluate(READINESS_REQUIREMENTS_QUESTION);
  assert.equal(out.readiness_requirements.kind,
    "PROCEDURAL_REQUIREMENTS_QUESTION_NOT_AN_APPROVAL_OR_AUTHORIZATION");
  assert.equal(out.readiness_requirements.verdict,
    "OPERATOR_REQUIREMENTS_LISTED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.readiness_requirements.gate_opened, false);
  assert.equal(out.readiness_requirements.command_sent, false);
  assert.equal(out.readiness_requirements.any_action_taken_by_session, false);
  assert.equal(out.readiness_requirements.no_approval_phrase_solicited, true);
  assert.equal(out.readiness_requirements.no_secrets_requested, true);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the operator requirements keep every no-action boundary", () => {
  const out = evaluate(READINESS_REQUIREMENTS_QUESTION);
  for (const r of [
    "ONE_EXPLICIT_CHOICE_HOLD_OR_SEPARATE_OFFLINE_ANALYSIS_SCOPE",
    "LOG_YEAR_AND_TIMESTAMPS_DESCRIPTIVELY_ONLY",
    "SEPARATE_VERBATIM_APPROVAL_BEFORE_EACH_EXECUTION",
    "FINAL_SEPARATE_EXPLICIT_REENABLE_DECISION",
  ]) assert.ok(out.readiness_requirements.what_the_operator_must_supply.includes(r), r);
  for (const r of [
    "DO_NOT_SET_FINANCE_ENABLED_TRUE",
    "DO_NOT_DEPLOY_OR_SYNC_OR_MANUAL_DEPLOY",
    "DO_NOT_SEND_DATABASE_URL_OR_PASSWORD_OR_ROWS",
    "DO_NOT_RUN_ANY_FINANCIAL_ACTION_OR_WRITE_OR_REFUND_TEST",
  ]) assert.ok(out.readiness_requirements.what_the_operator_must_NOT_do.includes(r), r);
  assert.equal(out.readiness_requirements.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.equal(out.readiness_requirements.gate_status, "CLOSED_NOT_READY");
  assert.equal(out.readiness_requirements.reenable_gate, "CLOSED");
  assert.ok(out.limitations.includes(
    "REQUIREMENTS_LIST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
});

test("offline work stays lab-only and no earlier finding is altered", () => {
  const out = evaluate(READINESS_REQUIREMENTS_QUESTION);
  for (const r of [
    "OFFLINE_ANALYSIS_AND_TEST_ONLY_DESIGN_FOR_THE_REMAINING_BLOCKERS",
    "LAB_TESTS_ON_TEMPORARY_POSTGRES_ONLY",
    "NO_PRODUCTION_SQL_NO_DEPLOY_NO_TRUE",
  ]) assert.ok(out.readiness_requirements.what_the_session_can_do_offline_after_authorization.includes(r), r);
  for (const w of [
    "REQUIREMENTS_LISTED_IN_CHAT_OPENS_NO_GATE",
    "NO_APPROVAL_PHRASE_SOLICITED_NO_COMMAND_SENT",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.gate_plan.gates_to_open_before_readiness.length, 9);
  assert.equal(out.post_run_check.post_run_check_status, "COMPLETE");
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(GATE_PLAN_QUESTION).readiness_requirements, null);
});


const OFFLINE_ANALYSIS_AUTHORIZED = {
  ...structuredClone(READINESS_REQUIREMENTS_QUESTION),
  offline_analysis_authorization: {
    operator_text: "تكليف منفصل صريح بتحليل أوفلاين للموانع",
    kind: "SEPARATE_EXPLICIT_OFFLINE_ANALYSIS_SCOPE_AUTHORIZATION",
    verbatim_match: true,
    markdown_formatting_accepted: true,
    received_before_work: true,
    scope: "OFFLINE_ANALYSIS_ONLY",
    analysis_delivered: true,
    blockers_analyzed: 9,
    blockers_resolved: 0,
    gates_opened: 0,
    artifacts: [
      "prototypes/finance-app-identity/readiness-blockers-OFFLINE-ANALYSIS-TEST-ONLY.md",
      "prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json",
    ],
    boundary: "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE",
    no_blanket_approval: true,
    no_approval_phrase_solicited: true,
    no_secrets_requested: true,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    sql_executed: false,
    any_action_taken_on_production: false,
  },
};

test("the verbatim offline-analysis authorization is accepted but opens no gate", () => {
  const out = evaluate(OFFLINE_ANALYSIS_AUTHORIZED);
  assert.equal(out.offline_analysis.kind,
    "SEPARATE_EXPLICIT_OFFLINE_ANALYSIS_SCOPE_AUTHORIZATION");
  assert.equal(out.offline_analysis.verdict, "OFFLINE_ANALYSIS_DELIVERED_NO_GATE_OPENED");
  assert.equal(out.offline_analysis.verbatim_match, true);
  assert.equal(out.offline_analysis.markdown_formatting_accepted, true);
  assert.equal(out.offline_analysis.received_before_work, true);
  assert.equal(out.offline_analysis.analysis_delivered, true);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the delivered analysis resolves zero blockers and opens zero gates", () => {
  const out = evaluate(OFFLINE_ANALYSIS_AUTHORIZED);
  assert.equal(out.offline_analysis.blockers_analyzed, 9);
  assert.equal(out.offline_analysis.blockers_resolved, 0);
  assert.equal(out.offline_analysis.gates_opened, 0);
  assert.equal(out.offline_analysis.sql_executed, false);
  assert.equal(out.offline_analysis.any_action_taken_on_production, false);
  assert.equal(out.offline_analysis.no_blanket_approval, true);
  assert.equal(out.offline_analysis.each_blocker_still_requires,
    "SEPARATE_REVIEWED_TEXT_THEN_SEPARATE_VERBATIM_APPROVAL_THEN_ROLLBACK_PLAN");
  assert.equal(out.offline_analysis.gate_status, "CLOSED_NOT_READY");
  assert.equal(out.offline_analysis.reenable_gate, "CLOSED");
  assert.ok(out.limitations.includes("NINE_BLOCKERS_REMAIN_UNRESOLVED"));
  assert.ok(out.limitations.includes("OFFLINE_ANALYSIS_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
});

test("the analysis boundary forbids every production action", () => {
  const out = evaluate(OFFLINE_ANALYSIS_AUTHORIZED);
  assert.equal(out.offline_analysis.boundary,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE");
  assert.equal(out.offline_analysis.no_approval_phrase_solicited, true);
  assert.equal(out.offline_analysis.no_secrets_requested, true);
  assert.equal(out.offline_analysis.no_file_reference, true);
  assert.equal(out.offline_analysis.answer_delivered_in_chat, true);
  assert.equal(out.offline_analysis.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  for (const w of [
    "ANALYSIS_DELIVERED_BUT_NO_GATE_OPENED",
    "NO_BLOCKER_IS_RESOLVED_BY_ANALYSIS",
    "ANALYSIS_IS_NOT_A_REVIEWED_EXECUTABLE_TEXT_OR_AN_APPROVAL",
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE",
    "DO_NOT_SET_FINANCE_ENABLED_TRUE",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(READINESS_REQUIREMENTS_QUESTION).offline_analysis, null);
});


const NEXT_STEP_AFTER_ANALYSIS = {
  ...structuredClone(OFFLINE_ANALYSIS_AUTHORIZED),
  next_step_after_analysis: {
    operator_text: "ما الخطوه التاليه",
    kind: "PROCEDURAL_NEXT_STEP_AFTER_OFFLINE_ANALYSIS",
    received_in_chat: true,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_secrets_requested: true,
    gate_opened: false,
    command_sent: false,
    any_action_taken_by_session: false,
    reviewed_text_prepared: false,
    scope_authorization_solicited: false,
  },
};

test("the post-analysis next-step question is procedural and opens no gate", () => {
  const out = evaluate(NEXT_STEP_AFTER_ANALYSIS);
  assert.equal(out.next_step_after_analysis.kind,
    "PROCEDURAL_NEXT_STEP_AFTER_OFFLINE_ANALYSIS");
  assert.equal(out.next_step_after_analysis.verdict,
    "ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.next_step_after_analysis.gate_opened, false);
  assert.equal(out.next_step_after_analysis.command_sent, false);
  assert.equal(out.next_step_after_analysis.any_action_taken_by_session, false);
  assert.equal(out.next_step_after_analysis.reviewed_text_prepared, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the single request chooses one blocker and solicits no execution approval", () => {
  const out = evaluate(NEXT_STEP_AFTER_ANALYSIS);
  assert.equal(out.next_step_after_analysis.single_request,
    "CHOOSE_ONE_BLOCKER_FOR_A_REVIEWED_READ_ONLY_DRAFT");
  assert.equal(out.next_step_after_analysis.recommended_blocker,
    "DEPLOYED_APP_ROLE_IDENTITY_READ_ONLY_PROOF");
  assert.equal(out.next_step_after_analysis.one_line_to_reply,
    "أجيز إعداد نص مُراجَع للمانع ١ للمراجعة فقط، دون تنفيذ");
  assert.equal(out.next_step_after_analysis.no_execution_approval_phrase_solicited, true);
  assert.equal(out.next_step_after_analysis.no_blanket_approval, true);
  assert.equal(out.next_step_after_analysis.still_forbidden,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE");
  assert.ok(out.limitations.includes(
    "NEXT_STEP_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
});

test("the sequence after the choice keeps approval separate from execution", () => {
  const out = evaluate(NEXT_STEP_AFTER_ANALYSIS);
  assert.deepEqual(out.next_step_after_analysis.what_happens_after_the_choice, [
    "PREPARE_TEST_ONLY_REVIEW_DRAFT_NO_EXECUTABLE_SQL",
    "OPERATOR_REVIEWS_THE_TEXT",
    "SEPARATE_VERBATIM_APPROVAL_BEFORE_ANY_EXECUTION",
    "SEPARATE_ROLLBACK_PLAN",
    "THEN_VERIFICATION_NOT_REENABLE",
  ]);
  assert.equal(out.next_step_after_analysis.reenable_gate, "CLOSED");
  assert.equal(out.next_step_after_analysis.reenable_decision_solicited, false);
  for (const w of [
    "ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT",
    "NO_REVIEWED_TEXT_PREPARED_WITHOUT_A_SEPARATE_SCOPE_AUTHORIZATION",
    "NO_EXECUTION_APPROVAL_PHRASE_SOLICITED",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.offline_analysis.blockers_resolved, 0);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(OFFLINE_ANALYSIS_AUTHORIZED).next_step_after_analysis, null);
});


const REVIEW_DRAFT_AUTHORIZED = {
  ...structuredClone(NEXT_STEP_AFTER_ANALYSIS),
  review_draft_authorization: {
    operator_text: "أجيز إعداد نص مُراجَع للمانع ١ للمراجعة فقط، دون تنفيذ",
    kind: "SEPARATE_EXPLICIT_REVIEW_DRAFT_SCOPE_AUTHORIZATION",
    verbatim_match: true,
    markdown_formatting_accepted: true,
    received_before_preparation: true,
    scope: "REVIEW_DRAFT_ONLY_BLOCKER_1",
    blocker: "DEPLOYED_APP_ROLE_IDENTITY_READ_ONLY_PROOF",
    draft_prepared: true,
    draft_executable: false,
    draft_contains_executable_sql: false,
    draft_contains_secrets: false,
    artifact: "prototypes/finance-app-identity/blocker-01-deployed-app-identity-REVIEW-DRAFT-NOT-EXECUTABLE.md",
    review_delivered_in_chat: true,
    no_file_reference: true,
    no_secrets_requested: true,
    no_execution_approval_phrase_solicited: true,
    blockers_resolved: 0,
    gates_opened: 0,
    sql_executed: false,
    any_action_taken_on_production: false,
  },
};

test("the verbatim review-draft authorization prepares a non-executable draft", () => {
  const out = evaluate(REVIEW_DRAFT_AUTHORIZED);
  assert.equal(out.review_draft.kind,
    "SEPARATE_EXPLICIT_REVIEW_DRAFT_SCOPE_AUTHORIZATION");
  assert.equal(out.review_draft.verdict,
    "REVIEW_DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED");
  assert.equal(out.review_draft.verbatim_match, true);
  assert.equal(out.review_draft.markdown_formatting_accepted, true);
  assert.equal(out.review_draft.received_before_preparation, true);
  assert.equal(out.review_draft.draft_prepared, true);
  assert.equal(out.review_draft.draft_executable, false);
  assert.equal(out.review_draft.draft_contains_executable_sql, false);
  assert.equal(out.review_draft.draft_contains_secrets, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("a local probe proves the URL role, not the deployed app identity", () => {
  const out = evaluate(REVIEW_DRAFT_AUTHORIZED);
  assert.equal(out.review_draft.key_insight,
    "A_LOCAL_PROBE_PROVES_THE_URL_ROLE_NOT_THE_DEPLOYED_APP_IDENTITY");
  assert.equal(out.review_draft.blocker, "DEPLOYED_APP_ROLE_IDENTITY_READ_ONLY_PROOF");
  assert.equal(out.review_draft.acceptance_criteria_count, 6);
  assert.equal(out.review_draft.blockers_resolved, 0);
  assert.equal(out.review_draft.gates_opened, 0);
  assert.equal(out.review_draft.sql_executed, false);
  assert.equal(out.review_draft.any_action_taken_on_production, false);
  assert.ok(out.limitations.includes("BLOCKER_1_REMAINS_UNRESOLVED"));
  assert.ok(out.limitations.includes("REVIEW_DRAFT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
});

test("each prerequisite needs its own approval and the re-enable gate stays closed", () => {
  const out = evaluate(REVIEW_DRAFT_AUTHORIZED);
  for (const p of [
    "SEPARATE_APPROVAL_OF_THE_FINAL_REVIEWED_TEXT",
    "SEPARATE_APPROVAL_OF_THE_ROLLBACK_PLAN",
    "SEPARATE_APPROVAL_OF_THE_IN_SERVICE_DIAGNOSTIC_PATH",
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_THE_PATH_NEEDS_CODE",
    "OFFLINE_EVALUATION_OF_THE_OUTPUT_AFTER_EXECUTION",
  ]) assert.ok(out.review_draft.prerequisites_requiring_separate_approvals.includes(p), p);
  assert.equal(out.review_draft.no_execution_approval_phrase_solicited, true);
  assert.equal(out.review_draft.no_blanket_approval, true);
  assert.equal(out.review_draft.still_forbidden,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE");
  assert.equal(out.review_draft.next_step,
    "OPERATOR_REVIEWS_THE_DRAFT_THEN_SEPARATE_VERBATIM_APPROVAL_BEFORE_ANY_EXECUTION");
  assert.equal(out.review_draft.reenable_gate, "CLOSED");
  assert.equal(out.review_draft.reenable_decision_solicited, false);
  for (const w of [
    "DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED",
    "DRAFT_IS_NOT_AN_EXECUTION_APPROVAL_OR_A_REVIEWED_FINAL_TEXT",
    "NO_EXECUTABLE_SQL_AND_NO_SECRETS_IN_THE_DRAFT",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(NEXT_STEP_AFTER_ANALYSIS).review_draft, null);
});


const EXECUTION_REQUEST = {
  ...structuredClone(REVIEW_DRAFT_AUTHORIZED),
  execution_request: {
    operator_text: "موافق و نفذ",
    kind: "NON_VERBATIM_BUNDLED_EXECUTION_REQUEST_AGAINST_A_REVIEW_ONLY_DRAFT",
    received_in_chat: true,
    verbatim_final_text_approval: false,
    separate_rollback_plan_approval: false,
    separate_in_service_path_approval: false,
    separate_src_and_deploy_approvals: false,
    draft_is_executable: false,
    gate_opened: false,
    command_sent: false,
    sql_executed: false,
    any_action_taken_on_production: false,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_secrets_requested: true,
    no_approval_phrase_solicited: true,
  },
};

test("'OK and execute' is refused against a review-only draft", () => {
  const out = evaluate(EXECUTION_REQUEST);
  assert.equal(out.execution_request.kind,
    "NON_VERBATIM_BUNDLED_EXECUTION_REQUEST_AGAINST_A_REVIEW_ONLY_DRAFT");
  assert.equal(out.execution_request.verdict,
    "EXECUTION_REQUEST_REFUSED_DRAFT_NOT_APPROVED_NOT_EXECUTABLE");
  assert.equal(out.execution_request.draft_is_executable, false);
  assert.equal(out.execution_request.gate_opened, false);
  assert.equal(out.execution_request.command_sent, false);
  assert.equal(out.execution_request.sql_executed, false);
  assert.equal(out.execution_request.any_action_taken_on_production, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the refusal lists every missing separate approval", () => {
  const out = evaluate(EXECUTION_REQUEST);
  assert.equal(out.execution_request.verbatim_final_text_approval, false);
  assert.equal(out.execution_request.separate_rollback_plan_approval, false);
  assert.equal(out.execution_request.separate_in_service_path_approval, false);
  assert.equal(out.execution_request.separate_src_and_deploy_approvals, false);
  for (const r of [
    "THE_AUTHORIZED_SCOPE_WAS_REVIEW_ONLY_WITHOUT_EXECUTION",
    "THE_DRAFT_IS_DESCRIPTIVE_AND_CONTAINS_NO_EXECUTABLE_SQL",
    "AN_AMBIGUOUS_ACCEPTANCE_CANNOT_IMPLY_A_VERBATIM_APPROVAL",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "REENABLE_DECISION_IS_SEPARATE_AND_NOT_RECEIVED",
  ]) assert.ok(out.execution_request.reason_codes.includes(r), r);
  assert.equal(out.execution_request.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.ok(out.limitations.includes(
    "BLOCKER_1_REMAINS_UNRESOLVED_AFTER_THE_REFUSAL"));
});

test("the refusal keeps all boundaries and the earlier draft state", () => {
  const out = evaluate(EXECUTION_REQUEST);
  assert.equal(out.execution_request.no_approval_phrase_solicited, true);
  assert.equal(out.execution_request.no_secrets_requested, true);
  assert.equal(out.execution_request.still_forbidden,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE");
  assert.equal(out.execution_request.reenable_gate, "CLOSED");
  assert.equal(out.execution_request.reenable_decision_solicited, false);
  assert.equal(out.execution_request.next_step,
    "REVIEW_THE_DRAFT_THEN_A_SEPARATE_VERBATIM_APPROVAL_OF_A_FINAL_TEXT");
  for (const w of [
    "BUNDLED_OK_AND_EXECUTE_IS_NOT_A_SEPARATE_VERBATIM_APPROVAL",
    "NO_COMMAND_SENT_AND_NO_SQL_EXECUTED",
    "NO_FINAL_REVIEWED_TEXT_WAS_APPROVED",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.review_draft.draft_prepared, true);
  assert.equal(out.review_draft.draft_executable, false);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(REVIEW_DRAFT_AUTHORIZED).execution_request, null);
});


const DRAFT_ACCEPTED = {
  ...structuredClone(EXECUTION_REQUEST),
  draft_acceptance: {
    operator_text: "قبلتها",
    kind: "ACCEPTANCE_OF_THE_REVIEW_DRAFT_NOT_AN_EXECUTION_APPROVAL",
    received_in_chat: true,
    accepted_before_final_text_prepared: true,
    final_text_prepared: true,
    final_text_status: "FINAL_FOR_REVIEW_NOT_EXECUTED",
    final_sql_sha: "da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a",
    final_text_is_read_only: true,
    final_text_contains_secrets: false,
    verbatim_final_text_approval: false,
    separate_rollback_plan_approval: false,
    separate_in_service_path_approval: false,
    gate_opened: false,
    command_sent: false,
    sql_executed: false,
    any_action_taken_on_production: false,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_secrets_requested: true,
    no_approval_phrase_solicited: true,
  },
};

test("accepting the draft prepares a pinned final-for-review text, not an execution", () => {
  const out = evaluate(DRAFT_ACCEPTED);
  assert.equal(out.draft_acceptance.kind,
    "ACCEPTANCE_OF_THE_REVIEW_DRAFT_NOT_AN_EXECUTION_APPROVAL");
  assert.equal(out.draft_acceptance.verdict,
    "FINAL_FOR_REVIEW_TEXT_PREPARED_NOT_APPROVED_NOT_EXECUTED");
  assert.equal(out.draft_acceptance.accepted_before_final_text_prepared, true);
  assert.equal(out.draft_acceptance.final_text_prepared, true);
  assert.equal(out.draft_acceptance.final_sql_sha,
    "da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a");
  assert.equal(out.draft_acceptance.final_text_is_read_only, true);
  assert.equal(out.draft_acceptance.final_text_contains_secrets, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("no gate opens and no SQL or command is produced by the acceptance", () => {
  const out = evaluate(DRAFT_ACCEPTED);
  assert.equal(out.draft_acceptance.gate_opened, false);
  assert.equal(out.draft_acceptance.command_sent, false);
  assert.equal(out.draft_acceptance.sql_executed, false);
  assert.equal(out.draft_acceptance.any_action_taken_on_production, false);
  assert.equal(out.draft_acceptance.verbatim_final_text_approval, false);
  assert.equal(out.draft_acceptance.separate_rollback_plan_approval, false);
  assert.equal(out.draft_acceptance.separate_in_service_path_approval, false);
  assert.equal(out.draft_acceptance.reenable_gate, "CLOSED");
  assert.ok(out.limitations.includes(
    "FINAL_FOR_REVIEW_TEXT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  for (const w of [
    "ACCEPTANCE_IS_NOT_AN_EXECUTION_APPROVAL",
    "NO_COMMAND_SENT_AND_NO_SQL_EXECUTED",
    "FINAL_TEXT_IS_READ_ONLY_PINNED_AND_NOT_EXECUTED",
  ]) assert.ok(out.warnings.includes(w), w);
});

test("the five remaining separate approvals are still required", () => {
  const out = evaluate(DRAFT_ACCEPTED);
  assert.deepEqual(out.draft_acceptance.still_required, [
    "SEPARATE_VERBATIM_APPROVAL_OF_THE_FINAL_TEXT",
    "SEPARATE_APPROVAL_OF_THE_ROLLBACK_PLAN",
    "SEPARATE_APPROVAL_OF_THE_IN_SERVICE_DIAGNOSTIC_PATH",
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    "OFFLINE_EVALUATION_AFTER_EXECUTION",
  ]);
  assert.equal(out.draft_acceptance.next_step,
    "OPERATOR_REVIEWS_THE_FINAL_TEXT_THEN_SEPARATE_VERBATIM_APPROVAL");
  assert.equal(out.draft_acceptance.no_blanket_approval, true);
  assert.equal(out.draft_acceptance.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.equal(out.review_draft.draft_executable, false);
  assert.equal(out.execution_request.command_sent, false);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(EXECUTION_REQUEST).draft_acceptance, null);
});


const FINAL_PROBE_RESULT = {
  ...structuredClone(DRAFT_ACCEPTED),
  final_text_probe_result: {
    received_from: "OPERATOR_PASTED_JSON_IN_CHAT",
    received_in_chat: true,
    probe_scope: "DEPLOYED_APP_IDENTITY_READ_ONLY",
    probe_version: "1.2",
    read_only_transaction: "on",
    statement_timeout: "15s",
    current_user: "neondb_owner",
    session_user: "neondb_owner",
    role_flags: { superuser: false, bypass_rls: true, create_role: true, create_db: true, replication: true, can_login: true, inherit: true },
    inherited_roles: ["neon_superuser", "selahtone_app", "selahtone_finance_admin", "selahtone_finance_admin"],
    privileged_builtin_roles: ["neon_superuser", "pg_read_all_data", "pg_write_all_data"],
    finance_objects_owned_by_current_user: 0,
    can_create_in_finance: true,
    sha_pin_confirmed_by_session: false,
    rollback_confirmed: false,
    connection_source_verified_as_deployed_app: false,
    log_year_and_timestamps_absent: true,
    secrets_in_output: false,
    separate_verbatim_execution_approval_received: false,
    separate_rollback_plan_approval_received: false,
    separate_in_service_path_approval_received: false,
    executed_by_session: false,
  },
};

test("the pasted final-text result is a FAILED identity check", () => {
  const out = evaluate(FINAL_PROBE_RESULT);
  assert.equal(out.final_text_probe_result.verdict,
    "IDENTITY_CHECK_FAILED_CONNECTION_IS_NEONDB_OWNER_NOT_THE_APP_ROLE");
  assert.equal(out.final_text_probe_result.current_user, "neondb_owner");
  assert.equal(out.final_text_probe_result.session_user, "neondb_owner");
  assert.equal(out.final_text_probe_result.identity_check_failed, true);
  assert.equal(out.final_text_probe_result.interpretation,
    "RESULT_IS_NOT_A_PROOF_OF_THE_DEPLOYED_APP_IDENTITY");
  assert.equal(out.final_text_probe_result.blocker_1_status,
    "UNRESOLVED_AND_FAILED_ON_THIS_CONNECTION");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the privileged identity is recorded, not minimized or treated as a pass", () => {
  const out = evaluate(FINAL_PROBE_RESULT);
  assert.equal(out.final_text_probe_result.role_flags.bypass_rls, true);
  assert.equal(out.final_text_probe_result.role_flags.create_role, true);
  assert.deepEqual(out.final_text_probe_result.privileged_builtin_roles,
    ["neon_superuser", "pg_read_all_data", "pg_write_all_data"]);
  assert.equal(out.final_text_probe_result.can_create_in_finance, true);
  for (const r of [
    "CURRENT_USER_IS_NEONDB_OWNER",
    "PG_READ_ALL_DATA_AND_PG_WRITE_ALL_DATA_AND_NEON_SUPERUSER_ARE_INHERITED",
    "CONNECTION_SOURCE_IS_NOT_VERIFIED_AS_THE_DEPLOYED_APP",
  ]) assert.ok(out.final_text_probe_result.why_it_failed.includes(r), r);
});

test("the unsolicited result opens no gate and ratifies no execution", () => {
  const out = evaluate(FINAL_PROBE_RESULT);
  assert.equal(out.final_text_probe_result.executed_by_session, false);
  assert.equal(out.final_text_probe_result.secrets_in_output, false);
  assert.equal(out.final_text_probe_result.gates_opened, 0);
  assert.equal(out.final_text_probe_result.blockers_resolved, 0);
  assert.equal(out.final_text_probe_result.reenable_gate, "CLOSED");
  assert.equal(out.final_text_probe_result.deployed_app_identity,
    "STILL_UNVERIFIED_AND_POSSIBLY_NEONDB_OWNER");
  assert.equal(out.final_text_probe_result.database_url_switch, "UNVERIFIED_FROM_LOG");
  assert.ok(out.limitations.includes("MANUAL_EXECUTION_OUTSIDE_THE_APPROVAL_ORDER_IS_NOT_RATIFIED"));
  for (const w of [
    "FINAL_TEXT_PROBE_RESULT_RECEIVED_IDENTITY_CHECK_FAILED",
    "UNSOLICITED_OUTPUT_WITHOUT_A_SEPARATE_VERBATIM_EXECUTION_APPROVAL",
    "DO_NOT_TREAT_THIS_AS_A_PASS_OR_AS_AN_APPROVAL_OF_ANY_EXECUTION",
  ]) assert.ok(out.warnings.includes(w), w);
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(DRAFT_ACCEPTED).final_text_probe_result, null);
});


const SOURCE_CLARIFIED = {
  ...structuredClone(FINAL_PROBE_RESULT),
  connection_source_clarification: {
    operator_text: "**أُنشئ هذا الاتصال من** SQL Editor",
    kind: "PROCEDURAL_CLARIFICATION_NOT_AN_APPROVAL_OR_EXECUTION",
    received_in_chat: true,
    source: "NEON_SQL_EDITOR_ADMIN_SESSION",
    source_is_the_deployed_service: false,
    verdict: "NON_APP_CONNECTION_OUT_OF_SCOPE_FOR_DEPLOYED_APP_IDENTITY_PROOF",
    reclassification_of_section_75: "FAILED_ON_THIS_CONNECTION_RECLASSIFIED_AS_INAPPLICABLE_OUT_OF_SCOPE",
    editor_session_is_admin_role: true,
    no_new_evidence_about_deployed_app: true,
    database_url_switch: "STILL_UNVERIFIED_FROM_LOG",
    unreconciled_observations: [
      "FINANCE_OBJECTS_OWNED_BY_CURRENT_USER_0_CONFLICTS_WITH_C3_INVENTORY_80_OWNED_BY_NEONDB_OWNER",
      "DUPLICATE_SELAHTONE_FINANCE_ADMIN_MEMBERSHIP_ROW",
      "LOG_YEAR_AND_TIMESTAMPS_ABSENT",
      "SHA_PIN_AND_ROLLBACK_NOT_CONFIRMED",
    ],
    separate_verbatim_execution_approval_received: false,
    command_sent: false,
    sql_executed: false,
    gate_opened: false,
    any_financial_action: false,
    secrets_in_chat: false,
    no_secrets_requested: true,
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    answer_delivered_in_chat: true,
    no_file_reference: true,
  },
};

test("SQL Editor is an out-of-scope admin session, not the deployed service", () => {
  const out = evaluate(SOURCE_CLARIFIED);
  assert.equal(out.connection_source_clarification.source, "NEON_SQL_EDITOR_ADMIN_SESSION");
  assert.equal(out.connection_source_clarification.verdict,
    "NON_APP_CONNECTION_OUT_OF_SCOPE_FOR_DEPLOYED_APP_IDENTITY_PROOF");
  assert.equal(out.connection_source_clarification.source_is_the_deployed_service, false);
  assert.equal(out.connection_source_clarification.editor_session_is_admin_role, true);
  assert.equal(out.connection_source_clarification.no_new_evidence_about_deployed_app, true);
  assert.equal(out.final_text_probe_result.source_classification,
    "NEON_SQL_EDITOR_ADMIN_SESSION_OUT_OF_SCOPE");
  assert.equal(out.final_text_probe_result.blocker_1_status,
    "UNRESOLVED_OUT_OF_SCOPE_ADMIN_SESSION_PROVIDES_NO_APP_EVIDENCE");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("section 75 is reclassified as inapplicable, never upgraded to a pass", () => {
  const out = evaluate(SOURCE_CLARIFIED);
  assert.equal(out.connection_source_clarification.reclassification_of_section_75,
    "FAILED_ON_THIS_CONNECTION_RECLASSIFIED_AS_INAPPLICABLE_OUT_OF_SCOPE");
  assert.equal(out.connection_source_clarification.deployed_app_identity, "STILL_UNVERIFIED");
  assert.equal(out.connection_source_clarification.database_url_switch,
    "STILL_UNVERIFIED_FROM_LOG");
  assert.equal(out.connection_source_clarification.still_required,
    "AN_IDENTITY_PROBE_FROM_A_CONNECTION_CREATED_INSIDE_THE_DEPLOYED_PROCESS");
  assert.ok(out.warnings.includes(
    "RECLASSIFY_SECTION_75_AS_INAPPLICABLE_NOT_A_PASS_OR_FAIL_OF_THE_APP"));
  assert.ok(out.limitations.includes("EDITOR_SESSION_CANNOT_SUPPLY_DEPLOYED_APP_IDENTITY"));
});

test("the clarification opens no gate and records the unreconciled observations", () => {
  const out = evaluate(SOURCE_CLARIFIED);
  assert.equal(out.connection_source_clarification.command_sent, false);
  assert.equal(out.connection_source_clarification.sql_executed, false);
  assert.equal(out.connection_source_clarification.gate_opened, false);
  assert.equal(out.connection_source_clarification.any_financial_action, false);
  assert.equal(out.connection_source_clarification.no_approval_phrase_solicited, true);
  assert.equal(out.connection_source_clarification.no_reenable_decision_solicited, true);
  assert.equal(out.connection_source_clarification.reenable_gate, "CLOSED");
  assert.equal(out.connection_source_clarification.blockers_resolved, 0);
  assert.equal(out.connection_source_clarification.gates_opened, 0);
  assert.equal(out.connection_source_clarification.c1_c2_for_deployed_app, "FAIL");
  assert.ok(out.connection_source_clarification.unreconciled_observations.includes(
    "FINANCE_OBJECTS_OWNED_BY_CURRENT_USER_0_CONFLICTS_WITH_C3_INVENTORY_80_OWNED_BY_NEONDB_OWNER"));
  assert.equal(out.connection_source_clarification.approvals_still_missing.length, 5);
  assert.equal(evaluate(FINAL_PROBE_RESULT).connection_source_clarification, null);
});


const ACTION_REQUEST = {
  ...structuredClone(SOURCE_CLARIFIED),
  operator_action_request: {
    operator_text: "قولي اعمل ايه",
    kind: "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    received_in_chat: true,
    verdict: "OPERATOR_ACTION_ADVICE_DELIVERED_IN_CHAT_NO_GATE_OPENED",
    primary_action: "HOLD_FINANCE_ENABLED_FALSE_AND_TAKE_NO_PLATFORM_ACTION",
    one_concrete_request: "SEPARATE_COMMISSION_TO_PREPARE_A_REVIEWED_TEXT_FOR_AN_IN_SERVICE_IDENTITY_PROBE",
    optional_next_commission_is_review_only: true,
    forbidden_now: ["NO_SQL_EDITOR_PROBE", "NO_RENDER_ENV_CHANGE", "NO_MANUAL_DEPLOY", "NO_SYNC", "NO_TRUE", "NO_FINANCIAL_ACTION", "NO_SRC_NO_RENDER_YAML"],
    no_approval_phrase_solicited: true,
    no_verbatim_execution_approval_solicited: true,
    no_reenable_decision_solicited: true,
    command_sent: false,
    sql_executed: false,
    gate_opened: false,
    answer_delivered_in_chat: true,
    no_file_reference: true,
    no_secrets_requested: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("what should I do is procedural advice, not a decision", () => {
  const out = evaluate(ACTION_REQUEST);
  assert.equal(out.operator_action_request.kind,
    "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL");
  assert.equal(out.operator_action_request.verdict,
    "OPERATOR_ACTION_ADVICE_DELIVERED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.operator_action_request.primary_action,
    "HOLD_FINANCE_ENABLED_FALSE_AND_TAKE_NO_PLATFORM_ACTION");
  assert.equal(out.operator_action_request.why,
    "AN_IDENTITY_PROBE_FROM_A_CONNECTION_CREATED_INSIDE_THE_DEPLOYED_PROCESS_IS_STILL_MISSING");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the one concrete request is review-only and solicits no approval phrase", () => {
  const out = evaluate(ACTION_REQUEST);
  assert.equal(out.operator_action_request.one_concrete_request,
    "SEPARATE_COMMISSION_TO_PREPARE_A_REVIEWED_TEXT_FOR_AN_IN_SERVICE_IDENTITY_PROBE");
  assert.equal(out.operator_action_request.optional_next_commission_is_review_only, true);
  assert.equal(out.operator_action_request.no_approval_phrase_solicited, true);
  assert.equal(out.operator_action_request.no_verbatim_execution_approval_solicited, true);
  assert.equal(out.operator_action_request.no_reenable_decision_solicited, true);
  assert.equal(out.operator_action_request.no_secrets_requested, true);
  assert.equal(out.operator_action_request.no_file_reference, true);
  for (const w of ["NO_SQL_EDITOR_PROBE", "NO_RENDER_ENV_CHANGE", "NO_TRUE",
    "NO_SRC_NO_RENDER_YAML"]) assert.ok(
    out.operator_action_request.what_the_operator_should_not_do_now.includes(w), w);
});

test("procedural advice opens no gate and does not change blocker 1", () => {
  const out = evaluate(ACTION_REQUEST);
  assert.equal(out.operator_action_request.command_sent, false);
  assert.equal(out.operator_action_request.sql_executed, false);
  assert.equal(out.operator_action_request.gate_opened, false);
  assert.equal(out.operator_action_request.blockers_resolved, 0);
  assert.equal(out.operator_action_request.gates_opened, 0);
  assert.equal(out.operator_action_request.reenable_gate, "CLOSED");
  assert.equal(out.operator_action_request.c1_c2_for_deployed_app, "FAIL");
  assert.equal(out.connection_source_clarification.deployed_app_identity, "STILL_UNVERIFIED");
  assert.ok(out.limitations.includes("PROCEDURAL_ADVICE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.ok(out.warnings.includes("ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED"));
  assert.equal(evaluate(SOURCE_CLARIFIED).operator_action_request, null);
});


const PROBE_SOURCE_QUESTION = {
  ...structuredClone(ACTION_REQUEST),
  probe_source_question: {
    operator_text: "اجيب منين **AN_IDENTITY_PROBE_FROM_A_CONNECTION_CREATED_INSIDE_THE_DEPLOYED_PROCESS**",
    kind: "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    received_in_chat: true,
    verdict: "SOURCE_OF_EVIDENCE_EXPLAINED_IN_CHAT_NO_GATE_OPENED",
    answer: "ONLY_A_CONNECTION_CREATED_BY_THE_DEPLOYED_PROCESS_ITSELF_USING_ITS_OWN_RUNTIME_CONFIG",
    acceptable_sources: ["IN_SERVICE_DIAGNOSTIC_PATH_USING_THE_SERVICE_OWN_CONFIG", "CONNECTION_TIME_TELEMETRY_EMITTED_BY_THE_SERVICE_DB_CLIENT"],
    acceptable_sources_require: ["SEPARATE_VERBATIM_APPROVAL_OF_A_FINAL_TEXT", "SEPARATE_ROLLBACK_PLAN_APPROVAL", "SEPARATE_IN_SERVICE_PATH_APPROVAL", "SEPARATE_SRC_APPROVAL_IF_NEEDED", "SEPARATE_DEPLOY_APPROVAL_IF_NEEDED", "OFFLINE_EVALUATION_AFTER_EXECUTION"],
    not_acceptable_sources: ["NEON_SQL_EDITOR_ADMIN_SESSION", "OPERATOR_LOCAL_C5_PROBE", "LOCAL_MAC_PROBE", "SETUP_OR_FINANCE_PAGE_WITH_FALSE", "RENDER_BUILD_DEPLOY_LOG", "OPERATOR_REPORT_ONLY", "NEON_CONSOLE_CLI_API_ROLE_INHERITANCE_PATH"],
    session_cannot_produce_it: true,
    session_bound: "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    database_url_switch: "UNVERIFIED_FROM_LOG",
    no_executable_sql_delivered: true,
    no_command_sent: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    sql_executed: false,
    gate_opened: false,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("the probe source is only the deployed process own connection", () => {
  const out = evaluate(PROBE_SOURCE_QUESTION);
  assert.equal(out.probe_source_question.kind,
    "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL");
  assert.equal(out.probe_source_question.verdict,
    "SOURCE_OF_EVIDENCE_EXPLAINED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.probe_source_question.answer,
    "ONLY_A_CONNECTION_CREATED_BY_THE_DEPLOYED_PROCESS_ITSELF_USING_ITS_OWN_RUNTIME_CONFIG");
  assert.equal(out.probe_source_question.acceptable_sources.length, 2);
  assert.equal(out.probe_source_question.acceptable_sources_require.length, 6);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("admin editor, local probe, UI and deploy logs cannot supply this proof", () => {
  const out = evaluate(PROBE_SOURCE_QUESTION);
  for (const s of ["NEON_SQL_EDITOR_ADMIN_SESSION", "OPERATOR_LOCAL_C5_PROBE",
    "SETUP_OR_FINANCE_PAGE_WITH_FALSE", "RENDER_BUILD_DEPLOY_LOG",
    "OPERATOR_REPORT_ONLY", "NEON_CONSOLE_CLI_API_ROLE_INHERITANCE_PATH"])
    assert.ok(out.probe_source_question.not_acceptable_sources.includes(s), s);
  assert.equal(out.probe_source_question.database_url_switch, "UNVERIFIED_FROM_LOG");
  assert.equal(out.probe_source_question.session_cannot_produce_it, true);
  assert.equal(out.probe_source_question.session_bound,
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS");
});

test("guidance delivers no SQL and opens no gate", () => {
  const out = evaluate(PROBE_SOURCE_QUESTION);
  assert.equal(out.probe_source_question.no_executable_sql_delivered, true);
  assert.equal(out.probe_source_question.no_command_sent, true);
  assert.equal(out.probe_source_question.no_secrets_in_chat, true);
  assert.equal(out.probe_source_question.no_file_reference, true);
  assert.equal(out.probe_source_question.no_approval_phrase_solicited, true);
  assert.equal(out.probe_source_question.no_reenable_decision_solicited, true);
  assert.equal(out.probe_source_question.sql_executed, false);
  assert.equal(out.probe_source_question.gate_opened, false);
  assert.equal(out.probe_source_question.blockers_resolved, 0);
  assert.equal(out.probe_source_question.gates_opened, 0);
  assert.equal(out.probe_source_question.reenable_gate, "CLOSED");
  assert.ok(out.limitations.includes("PROCEDURAL_GUIDANCE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.ok(out.warnings.includes("IN_SERVICE_PROBE_REQUIRES_SEPARATE_SRC_AND_DEPLOY_APPROVALS"));
  assert.equal(evaluate(ACTION_REQUEST).probe_source_question, null);
});


const NEXT_STEP_AFTER_SOURCE = {
  ...structuredClone(PROBE_SOURCE_QUESTION),
  next_step_after_probe_source: {
    operator_text: "ما الخطوه التاليه",
    kind: "PROCEDURAL_NEXT_STEP_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    received_in_chat: true,
    verdict: "ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED",
    primary_action: "HOLD_FINANCE_ENABLED_FALSE_AND_TAKE_NO_PLATFORM_ACTION",
    one_concrete_request: "SEPARATE_COMMISSION_TO_PREPARE_A_REVIEWED_IN_SERVICE_IDENTITY_PROBE_TEXT_FOR_REVIEW_ONLY",
    is_not: "NOT_A_VERBATIM_APPROVAL_NOT_AN_EXECUTION_REQUEST_NOT_A_REENABLE_DECISION",
    sequence_after_commission: ["REVIEWED_TEXT", "SEPARATE_VERBATIM_APPROVAL", "ROLLBACK_PLAN", "SEPARATE_IN_SERVICE_PATH_APPROVAL", "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED", "OFFLINE_EVALUATION"],
    no_approval_phrase_solicited: true,
    no_verbatim_execution_approval_solicited: true,
    no_reenable_decision_solicited: true,
    command_sent: false,
    sql_delivered: false,
    secrets_in_chat: false,
    no_file_reference: true,
    gate_opened: false,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("the repeated next-step question stays procedural with one request", () => {
  const out = evaluate(NEXT_STEP_AFTER_SOURCE);
  assert.equal(out.next_step_after_probe_source.kind,
    "PROCEDURAL_NEXT_STEP_QUESTION_NOT_A_DECISION_OR_APPROVAL");
  assert.equal(out.next_step_after_probe_source.verdict,
    "ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.next_step_after_probe_source.one_concrete_request,
    "SEPARATE_COMMISSION_TO_PREPARE_A_REVIEWED_IN_SERVICE_IDENTITY_PROBE_TEXT_FOR_REVIEW_ONLY");
  assert.equal(out.next_step_after_probe_source.is_not,
    "NOT_A_VERBATIM_APPROVAL_NOT_AN_EXECUTION_REQUEST_NOT_A_REENABLE_DECISION");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the commission is review-only and the fixed order is preserved", () => {
  const out = evaluate(NEXT_STEP_AFTER_SOURCE);
  assert.deepEqual(out.next_step_after_probe_source.sequence_after_commission, [
    "REVIEWED_TEXT", "SEPARATE_VERBATIM_APPROVAL", "ROLLBACK_PLAN",
    "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED", "OFFLINE_EVALUATION",
  ]);
  assert.equal(out.next_step_after_probe_source.no_approval_phrase_solicited, true);
  assert.equal(out.next_step_after_probe_source.no_reenable_decision_solicited, true);
  assert.ok(out.warnings.includes("DO_NOT_REPEAT_THE_SQL_EDITOR_PROBE"));
  assert.ok(out.warnings.includes("ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED"));
});

test("no gate opens, no SQL or command is delivered", () => {
  const out = evaluate(NEXT_STEP_AFTER_SOURCE);
  assert.equal(out.next_step_after_probe_source.command_sent, false);
  assert.equal(out.next_step_after_probe_source.sql_delivered, false);
  assert.equal(out.next_step_after_probe_source.secrets_in_chat, false);
  assert.equal(out.next_step_after_probe_source.no_file_reference, true);
  assert.equal(out.next_step_after_probe_source.gate_opened, false);
  assert.equal(out.next_step_after_probe_source.blockers_resolved, 0);
  assert.equal(out.next_step_after_probe_source.gates_opened, 0);
  assert.equal(out.next_step_after_probe_source.reenable_gate, "CLOSED");
  assert.equal(out.next_step_after_probe_source.c1_c2_for_deployed_app, "FAIL");
  assert.ok(out.limitations.includes("PROCEDURAL_NEXT_STEP_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(PROBE_SOURCE_QUESTION).next_step_after_probe_source, null);
});


const DIRECT_EXECUTION_REQUEST = {
  ...structuredClone(NEXT_STEP_AFTER_SOURCE),
  direct_execution_request: {
    operator_text: "انا اريد تنفيذ مباشره",
    kind: "DIRECT_EXECUTION_REQUEST_NOT_A_SEPARATE_VERBATIM_APPROVAL",
    received_in_chat: true,
    verdict: "DIRECT_EXECUTION_REQUEST_REFUSED_NOT_READY",
    is_verbatim_approval_of_a_final_text: false,
    names_a_pinned_final_text: false,
    names_a_rollback_plan: false,
    names_an_in_service_path: false,
    has_separate_src_and_deploy_approvals: false,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    secrets_in_chat: false,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a direct execution request is refused while NOT_READY", () => {
  const out = evaluate(DIRECT_EXECUTION_REQUEST);
  assert.equal(out.direct_execution_request.kind,
    "DIRECT_EXECUTION_REQUEST_NOT_A_SEPARATE_VERBATIM_APPROVAL");
  assert.equal(out.direct_execution_request.verdict,
    "DIRECT_EXECUTION_REQUEST_REFUSED_NOT_READY");
  assert.equal(out.direct_execution_request.is_verbatim_approval_of_a_final_text, false);
  assert.equal(out.direct_execution_request.no_action_scope,
    "NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("refusal delivers no command, no SQL, and opens no gate", () => {
  const out = evaluate(DIRECT_EXECUTION_REQUEST);
  assert.equal(out.direct_execution_request.no_command_sent, true);
  assert.equal(out.direct_execution_request.no_sql_delivered, true);
  assert.equal(out.direct_execution_request.no_gate_opened, true);
  assert.equal(out.direct_execution_request.no_action_taken_on_production, true);
  assert.equal(out.direct_execution_request.no_approval_phrase_solicited, true);
  assert.equal(out.direct_execution_request.no_reenable_decision_solicited, true);
  assert.equal(out.direct_execution_request.no_file_reference, true);
  assert.equal(out.direct_execution_request.blockers_resolved, 0);
  assert.equal(out.direct_execution_request.gates_opened, 0);
  assert.equal(out.direct_execution_request.finance_enabled, false);
  assert.ok(out.warnings.includes("NO_COMMAND_NO_SQL_NO_GATE_NO_ACTION"));
  assert.ok(out.limitations.includes("EXECUTION_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
});

test("the refusal preserves the strict policy and the fixed order", () => {
  const out = evaluate(DIRECT_EXECUTION_REQUEST);
  assert.equal(out.direct_execution_request.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.equal(out.direct_execution_request.session_bound,
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS");
  assert.deepEqual(out.direct_execution_request.still_required, [
    "REVIEWED_TEXT", "SEPARATE_VERBATIM_APPROVAL", "ROLLBACK_PLAN",
    "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED", "OFFLINE_EVALUATION",
  ]);
  assert.ok(out.direct_execution_request.why_refused.includes(
    "AN_AMBIGUOUS_ACCEPTANCE_CANNOT_IMPLY_A_VERBATIM_APPROVAL"));
  assert.equal(out.c1_c2_for_deployed_app, "FAIL");
  assert.equal(evaluate(NEXT_STEP_AFTER_SOURCE).direct_execution_request, null);
});


const APPROVAL_DELIVERY_QUESTION = {
  ...structuredClone(DIRECT_EXECUTION_REQUEST),
  approval_delivery_question: {
    operator_text: "كيف ارسلك نص الموافقه",
    kind: "PROCEDURAL_QUESTION_ABOUT_APPROVAL_DELIVERY_NOT_AN_APPROVAL",
    received_in_chat: true,
    verdict: "APPROVAL_DELIVERY_MECHANISM_EXPLAINED_IN_CHAT_NO_PHRASE_SOLICITED",
    channel: "PLAIN_CHAT_MESSAGE_ONLY",
    shape: "SEPARATE_STANDALONE_VERBATIM_COMPLETE_UNMODIFIED_MESSAGE_NAMING_THE_PINNED_TEXT_AND_ROLLBACK_PLAN_AND_IN_SERVICE_PATH",
    must_not_include: "NO_DATABASE_URL_NO_PASSWORD_NO_ROWS_NO_SECRETS_NO_BUNDLED_EXECUTION_REQUEST",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_approval_template_delivered: true,
    no_reenable_decision_solicited: true,
    approval_does_not_open_reenable_gate: true,
    session_bound: "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("how to send approval is procedural, not an approval", () => {
  const out = evaluate(APPROVAL_DELIVERY_QUESTION);
  assert.equal(out.approval_delivery_question.kind,
    "PROCEDURAL_QUESTION_ABOUT_APPROVAL_DELIVERY_NOT_AN_APPROVAL");
  assert.equal(out.approval_delivery_question.verdict,
    "APPROVAL_DELIVERY_MECHANISM_EXPLAINED_IN_CHAT_NO_PHRASE_SOLICITED");
  assert.equal(out.approval_delivery_question.channel, "PLAIN_CHAT_MESSAGE_ONLY");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the mechanism names shape and prohibitions without a template", () => {
  const out = evaluate(APPROVAL_DELIVERY_QUESTION);
  assert.equal(out.approval_delivery_question.shape,
    "SEPARATE_STANDALONE_VERBATIM_COMPLETE_UNMODIFIED_MESSAGE_NAMING_THE_PINNED_TEXT_AND_ROLLBACK_PLAN_AND_IN_SERVICE_PATH");
  assert.equal(out.approval_delivery_question.must_not_include,
    "NO_DATABASE_URL_NO_PASSWORD_NO_ROWS_NO_SECRETS_NO_BUNDLED_EXECUTION_REQUEST");
  assert.equal(out.approval_delivery_question.no_approval_phrase_solicited, true);
  assert.equal(out.approval_delivery_question.no_approval_template_delivered, true);
  assert.equal(out.approval_delivery_question.no_reenable_decision_solicited, true);
  assert.equal(out.approval_delivery_question.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
});

test("explaining delivery opens no gate and does not re-enable finance", () => {
  const out = evaluate(APPROVAL_DELIVERY_QUESTION);
  assert.equal(out.approval_delivery_question.approval_does_not_open_reenable_gate, true);
  assert.equal(out.approval_delivery_question.session_bound,
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS");
  assert.equal(out.approval_delivery_question.no_command_sent, true);
  assert.equal(out.approval_delivery_question.no_sql_delivered, true);
  assert.equal(out.approval_delivery_question.no_gate_opened, true);
  assert.equal(out.approval_delivery_question.no_file_reference, true);
  assert.equal(out.approval_delivery_question.blockers_resolved, 0);
  assert.equal(out.approval_delivery_question.gates_opened, 0);
  assert.equal(out.approval_delivery_question.finance_enabled, false);
  assert.ok(out.warnings.includes("NO_APPROVAL_PHRASE_SOLICITED_AND_NO_TEMPLATE_DELIVERED"));
  assert.ok(out.limitations.includes("PROCEDURAL_GUIDANCE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(DIRECT_EXECUTION_REQUEST).approval_delivery_question, null);
});


const BARE_APPROVAL = {
  ...structuredClone(APPROVAL_DELIVERY_QUESTION),
  bare_approval: {
    operator_text: "موافق",
    kind: "TRUNCATED_BARE_APPROVAL_NOT_A_SEPARATE_VERBATIM_APPROVAL",
    received_in_chat: true,
    verdict: "AMBIGUOUS_BARE_APPROVAL_REFUSED_NOT_VERBATIM",
    is_verbatim_approval_of_a_final_text: false,
    names_a_pinned_final_text: false,
    names_a_rollback_plan: false,
    names_an_in_service_path: false,
    is_old_or_incomplete_or_different: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    secrets_in_chat: false,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a bare OK is a truncated ambiguous approval and is refused", () => {
  const out = evaluate(BARE_APPROVAL);
  assert.equal(out.bare_approval.kind,
    "TRUNCATED_BARE_APPROVAL_NOT_A_SEPARATE_VERBATIM_APPROVAL");
  assert.equal(out.bare_approval.verdict,
    "AMBIGUOUS_BARE_APPROVAL_REFUSED_NOT_VERBATIM");
  assert.equal(out.bare_approval.is_verbatim_approval_of_a_final_text, false);
  assert.equal(out.bare_approval.is_old_or_incomplete_or_different, true);
  assert.equal(out.bare_approval.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("bare OK names no pinned text, rollback plan or in-service path", () => {
  const out = evaluate(BARE_APPROVAL);
  assert.equal(out.bare_approval.names_a_pinned_final_text, false);
  assert.equal(out.bare_approval.names_a_rollback_plan, false);
  assert.equal(out.bare_approval.names_an_in_service_path, false);
  assert.ok(out.bare_approval.why_refused.includes(
    "BARE_OK_IS_NOT_A_STANDALONE_VERBATIM_COMPLETE_MESSAGE"));
  assert.ok(out.bare_approval.why_refused.includes(
    "AN_AMBIGUOUS_ACCEPTANCE_CANNOT_IMPLY_A_VERBATIM_APPROVAL"));
  assert.equal(out.bare_approval.no_action_scope,
    "NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION");
});

test("bare OK delivers nothing and opens no gate", () => {
  const out = evaluate(BARE_APPROVAL);
  assert.equal(out.bare_approval.no_command_sent, true);
  assert.equal(out.bare_approval.no_sql_delivered, true);
  assert.equal(out.bare_approval.no_gate_opened, true);
  assert.equal(out.bare_approval.no_action_taken_on_production, true);
  assert.equal(out.bare_approval.no_approval_phrase_solicited, true);
  assert.equal(out.bare_approval.no_reenable_decision_solicited, true);
  assert.equal(out.bare_approval.no_file_reference, true);
  assert.equal(out.bare_approval.blockers_resolved, 0);
  assert.equal(out.bare_approval.gates_opened, 0);
  assert.equal(out.bare_approval.finance_enabled, false);
  assert.ok(out.warnings.includes("STRICT_REJECT_POLICY_STILL_IN_FORCE"));
  assert.ok(out.limitations.includes("BARE_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(APPROVAL_DELIVERY_QUESTION).bare_approval, null);
});


const BUNDLED_APPROVALS = {
  ...structuredClone(BARE_APPROVAL),
  bundled_approvals: {
    operator_text: "1. ****موافق*** على  النص النهائي وخطة الرجوع.\n\n2. ****موافق** على مسار التنفيذ داخل الخدمة.\n\n3. ****موافقتا** `src` **ونشر منفصلتان**** إن تطلب المسار كودًا.",
    kind: "BUNDLED_APPROVALS_ON_AN_OLD_OR_NOT_YET_PREPARED_TEXT",
    received_in_chat: true,
    verdict: "BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    is_old_or_incomplete_or_different: true,
    references_the_pinned_in_service_reviewed_text: false,
    in_service_reviewed_text_prepared: false,
    final_text_of_section_74_sha: "da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a",
    section_74_result: "NON_APP_CONNECTION_OUT_OF_SCOPE_FOR_DEPLOYED_APP_IDENTITY_PROOF",
    bundles_text_with_rollback_plan: true,
    fixed_order_violated: "ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_changed: true,
    no_render_yaml_changed: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    secrets_in_chat: false,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("numbered approvals on the old text are refused by strict reject", () => {
  const out = evaluate(BUNDLED_APPROVALS);
  assert.equal(out.bundled_approvals.kind,
    "BUNDLED_APPROVALS_ON_AN_OLD_OR_NOT_YET_PREPARED_TEXT");
  assert.equal(out.bundled_approvals.verdict,
    "BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.bundled_approvals.is_old_or_incomplete_or_different, true);
  assert.equal(out.bundled_approvals.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the in-service reviewed text does not exist yet and the old one is out of scope", () => {
  const out = evaluate(BUNDLED_APPROVALS);
  assert.equal(out.bundled_approvals.in_service_reviewed_text_prepared, false);
  assert.equal(out.bundled_approvals.references_the_pinned_in_service_reviewed_text, false);
  assert.equal(out.bundled_approvals.final_text_of_section_74_sha,
    "da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a");
  assert.equal(out.bundled_approvals.section_74_result,
    "NON_APP_CONNECTION_OUT_OF_SCOPE_FOR_DEPLOYED_APP_IDENTITY_PROOF");
  assert.equal(out.bundled_approvals.fixed_order_violated,
    "ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL");
  assert.ok(out.bundled_approvals.why_refused.includes(
    "IN_SERVICE_REVIEWED_TEXT_NOT_PREPARED_YET"));
});

test("bundled approvals change no source, deploy nothing, open no gate", () => {
  const out = evaluate(BUNDLED_APPROVALS);
  for (const k of ["no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_action_taken_on_production", "no_src_changed", "no_render_yaml_changed",
    "no_deploy", "no_sync", "no_true", "no_approval_phrase_solicited",
    "no_reenable_decision_solicited", "no_file_reference"])
    assert.equal((out.bundled_approvals as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.bundled_approvals.no_action_scope,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE");
  assert.equal(out.bundled_approvals.blockers_resolved, 0);
  assert.equal(out.bundled_approvals.gates_opened, 0);
  assert.equal(out.bundled_approvals.finance_enabled, false);
  assert.ok(out.limitations.includes("BUNDLED_APPROVALS_DO_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.ok(out.warnings.includes("APPROVAL_POINTS_AT_THE_OLD_SECTION_74_TEXT_OUT_OF_SCOPE"));
  assert.equal(evaluate(BARE_APPROVAL).bundled_approvals, null);
});


const APPROVAL_SHAPE_REQUEST = {
  ...structuredClone(BUNDLED_APPROVALS),
  approval_shape_request: {
    operator_text: "ماذا تريد موافقتي ان تكون باي شكل قل لي بالتحديد خطوه خطوه",
    kind: "PROCEDURAL_REQUEST_FOR_APPROVAL_SHAPE_NOT_AN_APPROVAL",
    received_in_chat: true,
    verdict: "APPROVAL_SHAPE_EXPLAINED_STEP_BY_STEP_NO_TEMPLATE_NO_PHRASE_SOLICITED",
    no_approval_template_delivered: true,
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    why_no_template: "IN_SERVICE_REVIEWED_TEXT_NOT_PREPARED_YET_AND_NO_PHRASE_SOLICITED",
    shape_properties: ["PLAIN_CHAT_MESSAGE_ONLY", "STANDALONE_SINGLE_MESSAGE", "VERBATIM_COMPLETE_UNMODIFIED", "NAMES_THE_PINNED_TEXT_BY_ITS_SHA", "NO_BUNDLED_EXECUTION_REQUEST", "NO_DATABASE_URL_NO_PASSWORD_NO_ROWS_NO_SECRETS", "NO_FILE_REFERENCE"],
    step_by_step: ["HOLD_FINANCE_ENABLED_FALSE_NO_PLATFORM_ACTION", "SEPARATE_COMMISSION_FOR_A_REVIEWED_IN_SERVICE_TEXT", "PREPARE_THE_PINNED_REVIEWED_TEXT_WITH_ACCEPTANCE_CRITERIA", "OPERATOR_REVIEWS_THAT_TEXT", "SEPARATE_VERBATIM_APPROVAL_OF_THAT_TEXT_ONLY", "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL", "SEPARATE_IN_SERVICE_PATH_APPROVAL", "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED", "EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION", "OFFLINE_EVALUATION", "SEPARATE_REENABLE_DECISION_NOT_SOLICITED"],
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("approval shape request is procedural with no template delivered", () => {
  const out = evaluate(APPROVAL_SHAPE_REQUEST);
  assert.equal(out.approval_shape_request.kind,
    "PROCEDURAL_REQUEST_FOR_APPROVAL_SHAPE_NOT_AN_APPROVAL");
  assert.equal(out.approval_shape_request.verdict,
    "APPROVAL_SHAPE_EXPLAINED_STEP_BY_STEP_NO_TEMPLATE_NO_PHRASE_SOLICITED");
  assert.equal(out.approval_shape_request.no_approval_template_delivered, true);
  assert.equal(out.approval_shape_request.no_approval_phrase_solicited, true);
  assert.equal(out.approval_shape_request.no_reenable_decision_solicited, true);
  assert.equal(out.approval_shape_request.why_no_template,
    "IN_SERVICE_REVIEWED_TEXT_NOT_PREPARED_YET_AND_NO_PHRASE_SOLICITED");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the shape properties and the fixed step order are complete", () => {
  const out = evaluate(APPROVAL_SHAPE_REQUEST);
  assert.equal(out.approval_shape_request.shape_properties.length, 7);
  assert.equal(out.approval_shape_request.step_by_step.length, 11);
  assert.equal(out.approval_shape_request.step_by_step[0],
    "HOLD_FINANCE_ENABLED_FALSE_NO_PLATFORM_ACTION");
  assert.equal(out.approval_shape_request.step_by_step[4],
    "SEPARATE_VERBATIM_APPROVAL_OF_THAT_TEXT_ONLY");
  assert.equal(out.approval_shape_request.step_by_step[8],
    "EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION");
  assert.equal(out.approval_shape_request.step_by_step[10],
    "SEPARATE_REENABLE_DECISION_NOT_SOLICITED");
  assert.ok(out.approval_shape_request.shape_properties.includes(
    "NAMES_THE_PINNED_TEXT_BY_ITS_SHA"));
});

test("shape guidance delivers nothing and opens no gate", () => {
  const out = evaluate(APPROVAL_SHAPE_REQUEST);
  assert.equal(out.approval_shape_request.no_command_sent, true);
  assert.equal(out.approval_shape_request.no_sql_delivered, true);
  assert.equal(out.approval_shape_request.no_gate_opened, true);
  assert.equal(out.approval_shape_request.no_action_taken_on_production, true);
  assert.equal(out.approval_shape_request.no_file_reference, true);
  assert.equal(out.approval_shape_request.no_action_scope,
    "NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE");
  assert.equal(out.approval_shape_request.blockers_resolved, 0);
  assert.equal(out.approval_shape_request.gates_opened, 0);
  assert.equal(out.approval_shape_request.finance_enabled, false);
  assert.ok(out.warnings.includes("NO_APPROVAL_TEMPLATE_DELIVERED_AND_NO_PHRASE_SOLICITED"));
  assert.ok(out.limitations.includes("APPROVAL_SHAPE_GUIDANCE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(BUNDLED_APPROVALS).approval_shape_request, null);
});


const CURRENT_STEP_QUESTION = {
  ...structuredClone(APPROVAL_SHAPE_REQUEST),
  current_step_question: {
    operator_text: "احنا في خطوه الان؟",
    kind: "PROCEDURAL_CURRENT_STEP_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    received_in_chat: true,
    verdict: "CURRENT_STEP_IDENTIFIED_IN_CHAT_NO_GATE_OPENED",
    current_step: "HOLD_FINANCE_ENABLED_FALSE_NO_PLATFORM_ACTION",
    current_step_index: 1,
    total_steps: 11,
    last_completed_milestone: "OFFLINE_ANALYSIS_OF_THE_NINE_BLOCKERS_SECTION_70",
    section_74_text_status: "FINAL_FOR_REVIEW_NOT_EXECUTED_THEN_RECLASSIFIED_OUT_OF_SCOPE",
    in_service_reviewed_text_prepared: false,
    step_2_commission: "NOT_RECEIVED_AS_A_SEPARATE_APPROVED_COMMISSION",
    prior_approvals_refused: ["SECTION_82_BARE_OK", "SECTION_83_BUNDLED_APPROVALS"],
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("current step is step 1 hold, with no gate opened", () => {
  const out = evaluate(CURRENT_STEP_QUESTION);
  assert.equal(out.current_step_question.kind,
    "PROCEDURAL_CURRENT_STEP_QUESTION_NOT_A_DECISION_OR_APPROVAL");
  assert.equal(out.current_step_question.verdict,
    "CURRENT_STEP_IDENTIFIED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.current_step_question.current_step,
    "HOLD_FINANCE_ENABLED_FALSE_NO_PLATFORM_ACTION");
  assert.equal(out.current_step_question.current_step_index, 1);
  assert.equal(out.current_step_question.total_steps, 11);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("step 2 commission and the in-service text are still missing", () => {
  const out = evaluate(CURRENT_STEP_QUESTION);
  assert.equal(out.current_step_question.in_service_reviewed_text_prepared, false);
  assert.equal(out.current_step_question.step_2_commission,
    "NOT_RECEIVED_AS_A_SEPARATE_APPROVED_COMMISSION");
  assert.equal(out.current_step_question.section_74_text_status,
    "FINAL_FOR_REVIEW_NOT_EXECUTED_THEN_RECLASSIFIED_OUT_OF_SCOPE");
  assert.equal(out.current_step_question.last_completed_milestone,
    "OFFLINE_ANALYSIS_OF_THE_NINE_BLOCKERS_SECTION_70");
  assert.deepEqual(out.current_step_question.prior_approvals_refused,
    ["SECTION_82_BARE_OK", "SECTION_83_BUNDLED_APPROVALS"]);
  assert.ok(out.warnings.includes("ALL_PRIOR_APPROVALS_WERE_REFUSED_STRICT_REJECT"));
});

test("the status answer delivers nothing and keeps finance disabled", () => {
  const out = evaluate(CURRENT_STEP_QUESTION);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_action_taken_on_production", "no_file_reference"])
    assert.equal((out.current_step_question as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.current_step_question.blockers_resolved, 0);
  assert.equal(out.current_step_question.gates_opened, 0);
  assert.equal(out.current_step_question.reenable_gate, "CLOSED");
  assert.equal(out.current_step_question.finance_enabled, false);
  assert.ok(out.limitations.includes("CURRENT_STEP_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(APPROVAL_SHAPE_REQUEST).current_step_question, null);
});


const HOLD_ACKNOWLEDGMENT = {
  ...structuredClone(CURRENT_STEP_QUESTION),
  hold_acknowledgment: {
    operator_text: "موافق علي **HOLD_FINANCE_ENABLED_FALSE_NO_PLATFORM_ACTION**",
    kind: "ACKNOWLEDGMENT_OF_THE_HOLD_STATUS_NOT_AN_EXECUTION_APPROVAL",
    received_in_chat: true,
    verdict: "HOLD_ACKNOWLEDGED_STATUS_UNCHANGED_NO_GATE_OPENED",
    accepted_step: 1,
    current_step_index: 1,
    total_steps: 11,
    does_not_advance_to_step_2: true,
    step_2_commission: "STILL_NOT_RECEIVED",
    in_service_reviewed_text_prepared: false,
    is_an_execution_approval: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("agreeing to the hold is an acknowledgment, not an execution approval", () => {
  const out = evaluate(HOLD_ACKNOWLEDGMENT);
  assert.equal(out.hold_acknowledgment.kind,
    "ACKNOWLEDGMENT_OF_THE_HOLD_STATUS_NOT_AN_EXECUTION_APPROVAL");
  assert.equal(out.hold_acknowledgment.verdict,
    "HOLD_ACKNOWLEDGED_STATUS_UNCHANGED_NO_GATE_OPENED");
  assert.equal(out.hold_acknowledgment.is_an_execution_approval, false);
  assert.equal(out.hold_acknowledgment.accepted_step, 1);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the acknowledgment does not advance to step 2 or prepare any text", () => {
  const out = evaluate(HOLD_ACKNOWLEDGMENT);
  assert.equal(out.hold_acknowledgment.current_step_index, 1);
  assert.equal(out.hold_acknowledgment.does_not_advance_to_step_2, true);
  assert.equal(out.hold_acknowledgment.step_2_commission, "STILL_NOT_RECEIVED");
  assert.equal(out.hold_acknowledgment.in_service_reviewed_text_prepared, false);
  assert.ok(out.warnings.includes("DOES_NOT_ADVANCE_TO_STEP_2_OR_PREPARE_ANY_TEXT"));
  assert.equal(out.current_step_question.current_step_index, 1);
});

test("hold acknowledgment changes nothing and keeps every gate closed", () => {
  const out = evaluate(HOLD_ACKNOWLEDGMENT);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_action_taken_on_production", "no_file_reference"])
    assert.equal((out.hold_acknowledgment as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.hold_acknowledgment.blockers_resolved, 0);
  assert.equal(out.hold_acknowledgment.gates_opened, 0);
  assert.equal(out.hold_acknowledgment.reenable_gate, "CLOSED");
  assert.equal(out.hold_acknowledgment.finance_enabled, false);
  assert.equal(out.hold_acknowledgment.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.ok(out.limitations.includes("HOLD_ACKNOWLEDGMENT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(CURRENT_STEP_QUESTION).hold_acknowledgment, null);
});


const REJECTION_REASON_QUESTION = {
  ...structuredClone(HOLD_ACKNOWLEDGMENT),
  rejection_reason_question: {
    operator_text: "لماذا مرفوضه",
    kind: "PROCEDURAL_QUESTION_ABOUT_THE_REFUSAL_NOT_AN_APPROVAL",
    received_in_chat: true,
    verdict: "REFUSAL_REASONS_EXPLAINED_IN_CHAT_NO_GATE_OPENED",
    refusals_explained: ["SECTION_82_BARE_OK", "SECTION_83_BUNDLED_APPROVALS"],
    root_cause: "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    reasons: ["IN_SERVICE_REVIEWED_TEXT_NOT_PREPARED_YET", "APPROVAL_POINTS_AT_THE_OLD_SECTION_74_TEXT_OUT_OF_SCOPE", "ROLLBACK_PLAN_BUNDLED_WITH_THE_TEXT_APPROVAL", "BARE_OK_IS_NOT_A_STANDALONE_VERBATIM_COMPLETE_MESSAGE", "AN_AMBIGUOUS_ACCEPTANCE_CANNOT_IMPLY_A_VERBATIM_APPROVAL", "NOT_READY_AND_IDENTITY_GAP_CONFIRMED"],
    hold_acknowledgment_status: "ACCEPTED_AS_ACKNOWLEDGMENT_NOT_AN_APPROVAL",
    hold_vs_approval: "HOLD_MATCHES_AN_EXISTING_STATE_APPROVAL_ATTEMPTS_TO_AUTHORIZE_A_MISSING_TEXT",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("why refused is procedural and names the root cause", () => {
  const out = evaluate(REJECTION_REASON_QUESTION);
  assert.equal(out.rejection_reason_question.kind,
    "PROCEDURAL_QUESTION_ABOUT_THE_REFUSAL_NOT_AN_APPROVAL");
  assert.equal(out.rejection_reason_question.verdict,
    "REFUSAL_REASONS_EXPLAINED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.rejection_reason_question.root_cause,
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES");
  assert.deepEqual(out.rejection_reason_question.refusals_explained,
    ["SECTION_82_BARE_OK", "SECTION_83_BUNDLED_APPROVALS"]);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the six reasons and the hold-versus-approval distinction are recorded", () => {
  const out = evaluate(REJECTION_REASON_QUESTION);
  assert.equal(out.rejection_reason_question.reasons.length, 6);
  for (const r of ["IN_SERVICE_REVIEWED_TEXT_NOT_PREPARED_YET",
    "APPROVAL_POINTS_AT_THE_OLD_SECTION_74_TEXT_OUT_OF_SCOPE",
    "ROLLBACK_PLAN_BUNDLED_WITH_THE_TEXT_APPROVAL",
    "AN_AMBIGUOUS_ACCEPTANCE_CANNOT_IMPLY_A_VERBATIM_APPROVAL"])
    assert.ok(out.rejection_reason_question.reasons.includes(r), r);
  assert.equal(out.rejection_reason_question.hold_acknowledgment_status,
    "ACCEPTED_AS_ACKNOWLEDGMENT_NOT_AN_APPROVAL");
  assert.equal(out.rejection_reason_question.hold_vs_approval,
    "HOLD_MATCHES_AN_EXISTING_STATE_APPROVAL_ATTEMPTS_TO_AUTHORIZE_A_MISSING_TEXT");
  assert.ok(out.warnings.includes("HOLD_WAS_ACKNOWLEDGED_NOT_REFUSED"));
});

test("the explanation changes nothing and opens no gate", () => {
  const out = evaluate(REJECTION_REASON_QUESTION);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_action_taken_on_production", "no_file_reference"])
    assert.equal((out.rejection_reason_question as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.rejection_reason_question.blockers_resolved, 0);
  assert.equal(out.rejection_reason_question.gates_opened, 0);
  assert.equal(out.rejection_reason_question.reenable_gate, "CLOSED");
  assert.equal(out.rejection_reason_question.finance_enabled, false);
  assert.equal(out.rejection_reason_question.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.ok(out.limitations.includes("REFUSAL_EXPLANATION_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(HOLD_ACKNOWLEDGMENT).rejection_reason_question, null);
});


const REPEATED_HOLD_ACKNOWLEDGMENT = {
  ...structuredClone(REJECTION_REASON_QUESTION),
  repeated_hold_acknowledgment: {
    operator_text: "**HOLD_FINANCE_ENABLED_FALSE_NO_PLATFORM_ACTION**\n\nموافق",
    kind: "REPEATED_HOLD_ACKNOWLEDGMENT_NOT_AN_EXECUTION_APPROVAL",
    received_in_chat: true,
    verdict: "DUPLICATE_HOLD_CONFIRMATION_RECORDED_STATUS_UNCHANGED_NO_GATE_OPENED",
    matches_section_86: true,
    named_hold_explicitly: true,
    is_an_execution_approval: false,
    differs_from_section_82: "BARE_OK_HAD_NO_EXPLICIT_STATE_REFERENCE",
    no_new_information: true,
    current_step_index: 1,
    total_steps: 11,
    step_2_commission: "STILL_NOT_RECEIVED",
    in_service_reviewed_text_prepared: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("repeating the named hold is a duplicate acknowledgment", () => {
  const out = evaluate(REPEATED_HOLD_ACKNOWLEDGMENT);
  assert.equal(out.repeated_hold_acknowledgment.kind,
    "REPEATED_HOLD_ACKNOWLEDGMENT_NOT_AN_EXECUTION_APPROVAL");
  assert.equal(out.repeated_hold_acknowledgment.verdict,
    "DUPLICATE_HOLD_CONFIRMATION_RECORDED_STATUS_UNCHANGED_NO_GATE_OPENED");
  assert.equal(out.repeated_hold_acknowledgment.matches_section_86, true);
  assert.equal(out.repeated_hold_acknowledgment.named_hold_explicitly, true);
  assert.equal(out.repeated_hold_acknowledgment.is_an_execution_approval, false);
  assert.equal(out.repeated_hold_acknowledgment.no_new_information, true);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("a named hold differs from the bare OK of section 82", () => {
  const out = evaluate(REPEATED_HOLD_ACKNOWLEDGMENT);
  assert.equal(out.repeated_hold_acknowledgment.differs_from_section_82,
    "BARE_OK_HAD_NO_EXPLICIT_STATE_REFERENCE");
  assert.equal(out.repeated_hold_acknowledgment.current_step_index, 1);
  assert.equal(out.repeated_hold_acknowledgment.step_2_commission, "STILL_NOT_RECEIVED");
  assert.equal(out.repeated_hold_acknowledgment.in_service_reviewed_text_prepared, false);
  assert.ok(out.warnings.includes("NAMED_HOLD_IS_NOT_A_BARE_OK"));
  assert.equal(out.hold_acknowledgment.accepted_step, 1);
});

test("the duplicate changes nothing and keeps every gate closed", () => {
  const out = evaluate(REPEATED_HOLD_ACKNOWLEDGMENT);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_action_taken_on_production", "no_file_reference"])
    assert.equal((out.repeated_hold_acknowledgment as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.repeated_hold_acknowledgment.blockers_resolved, 0);
  assert.equal(out.repeated_hold_acknowledgment.gates_opened, 0);
  assert.equal(out.repeated_hold_acknowledgment.reenable_gate, "CLOSED");
  assert.equal(out.repeated_hold_acknowledgment.finance_enabled, false);
  assert.ok(out.warnings.includes("REPEATED_HOLD_ACKNOWLEDGMENT_NO_NEW_INFORMATION"));
  assert.ok(out.limitations.includes("REPEATED_ACKNOWLEDGMENT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(REJECTION_REASON_QUESTION).repeated_hold_acknowledgment, null);
});


const CONTINUE_REQUEST = {
  ...structuredClone(REPEATED_HOLD_ACKNOWLEDGMENT),
  continue_request: {
    operator_text: "اكمل",
    kind: "AMBIGUOUS_CONTINUE_REQUEST_NOT_A_SEPARATE_COMMISSION_OR_APPROVAL",
    received_in_chat: true,
    verdict: "CONTINUE_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    is_approval: false,
    is_separate_commission: false,
    names_a_reviewed_text: false,
    names_the_step_2_commission: false,
    an_intent_to_finish_does_not_imply_permission: "DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH",
    current_step_index: 1,
    total_steps: 11,
    step_2_commission: "STILL_NOT_RECEIVED",
    in_service_reviewed_text_prepared: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("continue is neither an approval nor a separate commission", () => {
  const out = evaluate(CONTINUE_REQUEST);
  assert.equal(out.continue_request.kind,
    "AMBIGUOUS_CONTINUE_REQUEST_NOT_A_SEPARATE_COMMISSION_OR_APPROVAL");
  assert.equal(out.continue_request.verdict,
    "CONTINUE_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.continue_request.is_approval, false);
  assert.equal(out.continue_request.is_separate_commission, false);
  assert.equal(out.continue_request.names_a_reviewed_text, false);
  assert.equal(out.continue_request.names_the_step_2_commission, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("an intent to finish does not imply permission and step 1 holds", () => {
  const out = evaluate(CONTINUE_REQUEST);
  assert.equal(out.continue_request.an_intent_to_finish_does_not_imply_permission,
    "DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH");
  assert.equal(out.continue_request.current_step_index, 1);
  assert.equal(out.continue_request.step_2_commission, "STILL_NOT_RECEIVED");
  assert.equal(out.continue_request.in_service_reviewed_text_prepared, false);
  assert.ok(out.warnings.includes("AN_INTENT_TO_FINISH_DOES_NOT_IMPLY_PERMISSION"));
  assert.ok(out.warnings.includes("STATUS_STILL_STEP_1_NO_GATE_OPENED"));
});

test("continue delivers nothing and opens no gate", () => {
  const out = evaluate(CONTINUE_REQUEST);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_action_taken_on_production", "no_file_reference"])
    assert.equal((out.continue_request as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.continue_request.blockers_resolved, 0);
  assert.equal(out.continue_request.gates_opened, 0);
  assert.equal(out.continue_request.reenable_gate, "CLOSED");
  assert.equal(out.continue_request.finance_enabled, false);
  assert.equal(out.continue_request.strict_reject_phrase,
    "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
  assert.ok(out.limitations.includes("CONTINUE_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(REPEATED_HOLD_ACKNOWLEDGMENT).continue_request, null);
});


const REMAINING_STEPS_QUESTION = {
  ...structuredClone(CONTINUE_REQUEST),
  remaining_steps_question: {
    operator_text: "ماهي الخطوات المتبقيه لانجاز المهمه والنشر ؟",
    kind: "PROCEDURAL_ROADMAP_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    received_in_chat: true,
    verdict: "REMAINING_STEPS_LISTED_IN_CHAT_NO_GATE_OPENED",
    current_step_index: 1,
    total_steps: 11,
    remaining_for_blocker_1: ["SEPARATE_COMMISSION_FOR_A_REVIEWED_IN_SERVICE_TEXT", "PREPARE_THE_PINNED_REVIEWED_TEXT_WITH_ACCEPTANCE_CRITERIA", "OPERATOR_REVIEWS_THAT_TEXT", "SEPARATE_VERBATIM_APPROVAL_OF_THAT_TEXT_ONLY", "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL", "SEPARATE_IN_SERVICE_PATH_APPROVAL", "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED", "EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION", "OFFLINE_EVALUATION", "SEPARATE_REENABLE_DECISION_NOT_SOLICITED"],
    remaining_blockers: 9,
    all_blockers_status: "UNRESOLVED",
    no_blanket_approval: true,
    each_blocker_requires: ["REVIEWED_TEXT", "SEPARATE_VERBATIM_APPROVAL", "ROLLBACK_PLAN", "SEPARATE_IN_SERVICE_PATH_APPROVAL", "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED", "OFFLINE_EVALUATION"],
    reenable_gate: "CLOSED",
    reenable_decision_solicited: false,
    deploy_status: "PROHIBITED_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    overall: "NOT_READY",
  },
};

test("roadmap question is procedural and opens no gate", () => {
  const out = evaluate(REMAINING_STEPS_QUESTION);
  assert.equal(out.remaining_steps_question.kind,
    "PROCEDURAL_ROADMAP_QUESTION_NOT_A_DECISION_OR_APPROVAL");
  assert.equal(out.remaining_steps_question.verdict,
    "REMAINING_STEPS_LISTED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.remaining_steps_question.current_step_index, 1);
  assert.equal(out.remaining_steps_question.total_steps, 11);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the ten remaining steps and nine blockers are all recorded", () => {
  const out = evaluate(REMAINING_STEPS_QUESTION);
  assert.equal(out.remaining_steps_question.remaining_for_blocker_1.length, 10);
  assert.equal(out.remaining_steps_question.remaining_for_blocker_1[3],
    "SEPARATE_VERBATIM_APPROVAL_OF_THAT_TEXT_ONLY");
  assert.equal(out.remaining_steps_question.remaining_for_blocker_1[9],
    "SEPARATE_REENABLE_DECISION_NOT_SOLICITED");
  assert.equal(out.remaining_steps_question.remaining_blockers, 9);
  assert.equal(out.remaining_steps_question.all_blockers_status, "UNRESOLVED");
  assert.equal(out.remaining_steps_question.no_blanket_approval, true);
  assert.equal(out.remaining_steps_question.each_blocker_requires.length, 6);
  assert.ok(out.warnings.includes("NO_BLANKET_APPROVAL_EACH_BLOCKER_NEEDS_ITS_OWN_SEPARATE_CYCLE"));
});

test("deploy stays prohibited and the re-enable gate stays closed", () => {
  const out = evaluate(REMAINING_STEPS_QUESTION);
  assert.equal(out.remaining_steps_question.deploy_status,
    "PROHIBITED_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT");
  assert.equal(out.remaining_steps_question.reenable_gate, "CLOSED");
  assert.equal(out.remaining_steps_question.reenable_decision_solicited, false);
  assert.equal(out.remaining_steps_question.no_approval_phrase_solicited, true);
  assert.equal(out.remaining_steps_question.no_reenable_decision_solicited, true);
  assert.equal(out.remaining_steps_question.no_command_sent, true);
  assert.equal(out.remaining_steps_question.no_sql_delivered, true);
  assert.equal(out.remaining_steps_question.no_gate_opened, true);
  assert.equal(out.remaining_steps_question.finance_enabled, false);
  assert.ok(out.limitations.includes("ROADMAP_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(CONTINUE_REQUEST).remaining_steps_question, null);
});


const SEPARATE_COMMISSION = {
  ...structuredClone(REMAINING_STEPS_QUESTION),
  separate_commission: {
    operator_text: "تكليف **منفصل** بإعداد نص مُراجَع لمسار الفحص داخل الخدمة (مراجعة فقط)",
    kind: "SEPARATE_EXPLICIT_COMMISSION_FOR_A_REVIEW_ONLY_TEXT",
    received_in_chat: true,
    verdict: "REVIEWED_TEXT_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED",
    step_2_commission: "RECEIVED_VERBATIM_AS_A_SEPARATE_COMMISSION",
    commission_scope: "REVIEWED_TEXT_PREPARATION_ONLY",
    reviewed_text_prepared: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    reviewed_text_is_executable_sql: false,
    reviewed_text_contains_secrets: false,
    reviewed_text_presented_in_chat: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_production_sql: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    is_an_execution_approval: false,
    gate_opened: false,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "OPERATOR_REVIEWS_THAT_TEXT",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a separate explicit commission authorizes only a review-only text", () => {
  const out = evaluate(SEPARATE_COMMISSION);
  assert.equal(out.separate_commission.kind,
    "SEPARATE_EXPLICIT_COMMISSION_FOR_A_REVIEW_ONLY_TEXT");
  assert.equal(out.separate_commission.verdict,
    "REVIEWED_TEXT_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED");
  assert.equal(out.separate_commission.step_2_commission,
    "RECEIVED_VERBATIM_AS_A_SEPARATE_COMMISSION");
  assert.equal(out.separate_commission.commission_scope, "REVIEWED_TEXT_PREPARATION_ONLY");
  assert.equal(out.separate_commission.reviewed_text_prepared, true);
  assert.equal(out.separate_commission.reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the reviewed text is not executable SQL, has no secrets, and opens no gate", () => {
  const out = evaluate(SEPARATE_COMMISSION);
  assert.equal(out.separate_commission.reviewed_text_is_executable_sql, false);
  assert.equal(out.separate_commission.reviewed_text_contains_secrets, false);
  assert.equal(out.separate_commission.reviewed_text_presented_in_chat, true);
  assert.equal(out.separate_commission.is_an_execution_approval, false);
  assert.equal(out.separate_commission.gate_opened, false);
  assert.equal(out.separate_commission.blockers_resolved, 0);
  assert.equal(out.separate_commission.gates_opened, 0);
  assert.equal(out.separate_commission.finance_enabled, false);
  assert.ok(out.warnings.includes("REVIEW_ONLY_TEXT_IS_NOT_EXECUTABLE_SQL_AND_CONTAINS_NO_SECRETS"));
  assert.ok(out.limitations.includes("REVIEWED_TEXT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
});

test("no source, deploy, sync or true is authorized by the commission", () => {
  const out = evaluate(SEPARATE_COMMISSION);
  for (const k of ["no_src_modified", "no_render_yaml_modified", "no_production_sql",
    "no_deploy", "no_sync", "no_true", "no_approval_phrase_solicited",
    "no_reenable_decision_solicited"])
    assert.equal((out.separate_commission as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.separate_commission.next_descriptive_step, "OPERATOR_REVIEWS_THAT_TEXT");
  assert.equal(out.separate_commission.still_required.length, 8);
  assert.ok(out.separate_commission.still_required.includes(
    "SEPARATE_VERBATIM_APPROVAL_OF_THAT_TEXT_ONLY"));
  assert.equal(evaluate(REMAINING_STEPS_QUESTION).separate_commission, null);
});


const AMBIGUOUS_TEXT_APPROVAL = {
  ...structuredClone(SEPARATE_COMMISSION),
  ambiguous_text_approval: {
    operator_text: "موافق علي النص",
    kind: "AMBIGUOUS_TEXT_APPROVAL_NOT_A_SEPARATE_VERBATIM_APPROVAL",
    received_in_chat: true,
    verdict: "TEXT_APPROVAL_REFUSED_STRICT_REJECT_NOT_VERBATIM",
    references_pinned_sha: false,
    names_the_exact_text: false,
    reviewed_text_sha_expected: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    matches_section_82_pattern: true,
    differs_from_section_86: "HOLD_NAMED_A_FULL_EXACT_STATE_TOKEN_THIS_NAMES_ONLY_A_GENERIC_NOUN",
    step_5_approval_received: false,
    rollback_plan_prepared: false,
    in_service_path_approval: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "OPERATOR_REVIEWS_THAT_TEXT",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("approving a generic the text is refused, not a verbatim approval", () => {
  const out = evaluate(AMBIGUOUS_TEXT_APPROVAL);
  assert.equal(out.ambiguous_text_approval.kind,
    "AMBIGUOUS_TEXT_APPROVAL_NOT_A_SEPARATE_VERBATIM_APPROVAL");
  assert.equal(out.ambiguous_text_approval.verdict,
    "TEXT_APPROVAL_REFUSED_STRICT_REJECT_NOT_VERBATIM");
  assert.equal(out.ambiguous_text_approval.references_pinned_sha, false);
  assert.equal(out.ambiguous_text_approval.names_the_exact_text, false);
  assert.equal(out.ambiguous_text_approval.reviewed_text_sha_expected,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.ambiguous_text_approval.step_5_approval_received, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the generic noun differs from the exact hold token of section 86", () => {
  const out = evaluate(AMBIGUOUS_TEXT_APPROVAL);
  assert.equal(out.ambiguous_text_approval.differs_from_section_86,
    "HOLD_NAMED_A_FULL_EXACT_STATE_TOKEN_THIS_NAMES_ONLY_A_GENERIC_NOUN");
  assert.equal(out.ambiguous_text_approval.matches_section_82_pattern, true);
  assert.equal(out.ambiguous_text_approval.rollback_plan_prepared, false);
  assert.equal(out.ambiguous_text_approval.in_service_path_approval, false);
  assert.ok(out.warnings.includes("NO_PINNED_SHA_AND_NO_EXACT_TEXT_NAME_IN_THE_MESSAGE"));
  assert.ok(out.warnings.includes("GENERIC_NOUN_DIFFERS_FROM_THE_EXACT_HOLD_TOKEN_OF_SECTION_86"));
});

test("the ambiguous approval changes nothing and opens no gate", () => {
  const out = evaluate(AMBIGUOUS_TEXT_APPROVAL);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened", "no_action_taken_on_production",
    "no_src_modified", "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_file_reference"])
    assert.equal((out.ambiguous_text_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.ambiguous_text_approval.blockers_resolved, 0);
  assert.equal(out.ambiguous_text_approval.gates_opened, 0);
  assert.equal(out.ambiguous_text_approval.reenable_gate, "CLOSED");
  assert.equal(out.ambiguous_text_approval.finance_enabled, false);
  assert.ok(out.limitations.includes("TEXT_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.separate_commission.reviewed_text_prepared, true);
  assert.equal(evaluate(SEPARATE_COMMISSION).ambiguous_text_approval, null);
});


const NAMED_TEXT_APPROVAL = {
  ...structuredClone(AMBIGUOUS_TEXT_APPROVAL),
  named_text_approval: {
    operator_text: "موافق علي نص مسار الفحص داخل الخدمة",
    kind: "NAMED_IN_SERVICE_TEXT_APPROVAL_NOT_VERBATIM",
    received_in_chat: true,
    verdict: "NAMED_TEXT_ACKNOWLEDGED_STEP_5_STILL_CLOSED_STRICT_REJECT",
    names_the_in_service_text_explicitly: true,
    references_pinned_sha: false,
    reviewed_text_sha_expected: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    differs_from_section_92: "GENERIC_NOUN_UPGRADED_TO_AN_EXACT_SUBJECT_BUT_SHA_STILL_ABSENT",
    step_5_approval_received: false,
    rollback_plan_prepared: false,
    in_service_path_approval: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "OPERATOR_REVIEWS_THAT_TEXT",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("naming the exact subject is acknowledged but step 5 stays closed", () => {
  const out = evaluate(NAMED_TEXT_APPROVAL);
  assert.equal(out.named_text_approval.kind,
    "NAMED_IN_SERVICE_TEXT_APPROVAL_NOT_VERBATIM");
  assert.equal(out.named_text_approval.verdict,
    "NAMED_TEXT_ACKNOWLEDGED_STEP_5_STILL_CLOSED_STRICT_REJECT");
  assert.equal(out.named_text_approval.names_the_in_service_text_explicitly, true);
  assert.equal(out.named_text_approval.references_pinned_sha, false);
  assert.equal(out.named_text_approval.step_5_approval_received, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the exact subject improves on section 92 but the pinned SHA is still absent", () => {
  const out = evaluate(NAMED_TEXT_APPROVAL);
  assert.equal(out.named_text_approval.differs_from_section_92,
    "GENERIC_NOUN_UPGRADED_TO_AN_EXACT_SUBJECT_BUT_SHA_STILL_ABSENT");
  assert.equal(out.named_text_approval.reviewed_text_sha_expected,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.named_text_approval.rollback_plan_prepared, false);
  assert.equal(out.named_text_approval.in_service_path_approval, false);
  assert.ok(out.warnings.includes("EXACT_SUBJECT_PRESENT_BUT_PINNED_SHA_STILL_ABSENT"));
  assert.ok(out.warnings.includes("A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION"));
});

test("the named approval changes nothing and opens no gate", () => {
  const out = evaluate(NAMED_TEXT_APPROVAL);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened", "no_action_taken_on_production",
    "no_src_modified", "no_deploy", "no_sync", "no_true", "no_file_reference"])
    assert.equal((out.named_text_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.named_text_approval.blockers_resolved, 0);
  assert.equal(out.named_text_approval.gates_opened, 0);
  assert.equal(out.named_text_approval.reenable_gate, "CLOSED");
  assert.equal(out.named_text_approval.finance_enabled, false);
  assert.ok(out.limitations.includes("NAMED_TEXT_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.separate_commission.reviewed_text_prepared, true);
  assert.equal(evaluate(AMBIGUOUS_TEXT_APPROVAL).named_text_approval, null);
});


const VERBATIM_TEXT_APPROVAL = {
  ...structuredClone(NAMED_TEXT_APPROVAL),
  verbatim_text_approval: {
    operator_text: "موافق علي نص مسار الفحص داخل الخدمة\n\n**629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**",
    kind: "SEPARATE_VERBATIM_APPROVAL_OF_THE_PINNED_REVIEWED_TEXT",
    received_in_chat: true,
    verdict: "VERBATIM_APPROVAL_ACCEPTED_REVIEW_ONLY_TEXT_STEP_5_CLOSED_NO_GATE_OPENED",
    sha_verified: true,
    sha_matches_inventory: true,
    sha_value: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    names_the_in_service_text_explicitly: true,
    is_standalone_single_message: true,
    no_bundled_execution_request: true,
    no_secrets_in_message: true,
    no_file_reference: true,
    approval_scope: "REVIEWED_TEXT_ONLY_NOT_EXECUTION",
    is_an_execution_approval: false,
    step_5_approval_received: true,
    rollback_plan_prepared: false,
    in_service_path_approval: false,
    src_and_deploy_approvals: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("the pinned-SHA approval is verified and accepted for the review-only text", () => {
  const out = evaluate(VERBATIM_TEXT_APPROVAL);
  assert.equal(out.verbatim_text_approval.kind,
    "SEPARATE_VERBATIM_APPROVAL_OF_THE_PINNED_REVIEWED_TEXT");
  assert.equal(out.verbatim_text_approval.verdict,
    "VERBATIM_APPROVAL_ACCEPTED_REVIEW_ONLY_TEXT_STEP_5_CLOSED_NO_GATE_OPENED");
  assert.equal(out.verbatim_text_approval.sha_verified, true);
  assert.equal(out.verbatim_text_approval.sha_matches_inventory, true);
  assert.equal(out.verbatim_text_approval.sha_value,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.verbatim_text_approval.step_5_approval_received, true);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the approval scope is the review-only text, not execution", () => {
  const out = evaluate(VERBATIM_TEXT_APPROVAL);
  assert.equal(out.verbatim_text_approval.approval_scope,
    "REVIEWED_TEXT_ONLY_NOT_EXECUTION");
  assert.equal(out.verbatim_text_approval.is_an_execution_approval, false);
  assert.equal(out.verbatim_text_approval.is_standalone_single_message, true);
  assert.equal(out.verbatim_text_approval.no_bundled_execution_request, true);
  assert.equal(out.verbatim_text_approval.no_secrets_in_message, true);
  assert.equal(out.verbatim_text_approval.no_file_reference, true);
  assert.ok(out.warnings.includes("APPROVAL_SCOPE_IS_THE_REVIEW_ONLY_TEXT_NOT_EXECUTION"));
  assert.ok(out.warnings.includes("VERBATIM_APPROVAL_WITH_PINNED_SHA_VERIFIED_AND_ACCEPTED"));
});

test("step 5 closes descriptively but no gate opens and blocker 1 stays open", () => {
  const out = evaluate(VERBATIM_TEXT_APPROVAL);
  assert.equal(out.verbatim_text_approval.rollback_plan_prepared, false);
  assert.equal(out.verbatim_text_approval.in_service_path_approval, false);
  assert.equal(out.verbatim_text_approval.src_and_deploy_approvals, false);
  assert.equal(out.verbatim_text_approval.next_descriptive_step,
    "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL");
  assert.equal(out.verbatim_text_approval.no_command_sent, true);
  assert.equal(out.verbatim_text_approval.no_sql_delivered, true);
  assert.equal(out.verbatim_text_approval.no_gate_opened, true);
  assert.equal(out.verbatim_text_approval.blockers_resolved, 0);
  assert.equal(out.verbatim_text_approval.gates_opened, 0);
  assert.equal(out.verbatim_text_approval.reenable_gate, "CLOSED");
  assert.equal(out.verbatim_text_approval.finance_enabled, false);
  assert.ok(out.limitations.includes("VERBATIM_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(NAMED_TEXT_APPROVAL).verbatim_text_approval, null);
});


const PINNED_SHA_EXECUTION_REQUEST = {
  ...structuredClone(VERBATIM_TEXT_APPROVAL),
  pinned_sha_execution_request: {
    operator_text: "نفذ **629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**",
    kind: "EXECUTION_REQUEST_FOR_A_REVIEW_ONLY_TEXT",
    received_in_chat: true,
    verdict: "PINNED_SHA_EXECUTION_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    sha_present: true,
    sha_value: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    sha_verified: true,
    requested_text_is_executable: false,
    sha_alone_is_not_an_execution_authorization: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("execute with the pinned SHA is refused because the text is not executable", () => {
  const out = evaluate(PINNED_SHA_EXECUTION_REQUEST);
  assert.equal(out.pinned_sha_execution_request.kind,
    "EXECUTION_REQUEST_FOR_A_REVIEW_ONLY_TEXT");
  assert.equal(out.pinned_sha_execution_request.verdict,
    "PINNED_SHA_EXECUTION_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.pinned_sha_execution_request.sha_verified, true);
  assert.equal(out.pinned_sha_execution_request.requested_text_is_executable, false);
  assert.equal(out.pinned_sha_execution_request.sha_alone_is_not_an_execution_authorization, true);
  assert.equal(out.pinned_sha_execution_request.section_94_approval_scope,
    "REVIEWED_TEXT_ONLY_NOT_EXECUTION");
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the execution request precedes the rollback plan and in-service path approvals", () => {
  const out = evaluate(PINNED_SHA_EXECUTION_REQUEST);
  assert.equal(out.pinned_sha_execution_request.rollback_plan_prepared, false);
  assert.equal(out.pinned_sha_execution_request.in_service_path_approval, false);
  assert.equal(out.pinned_sha_execution_request.src_and_deploy_approvals, false);
  assert.equal(out.pinned_sha_execution_request.next_descriptive_step,
    "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL");
  for (const w of ["REQUESTED_TEXT_IS_REVIEW_ONLY_NOT_EXECUTABLE",
    "SHA_ALONE_IS_NOT_AN_EXECUTION_AUTHORIZATION",
    "ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL",
    "SEPARATE_IN_SERVICE_PATH_APPROVAL_MISSING",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the refusal sends no command, opens no gate, and changes no state", () => {
  const out = evaluate(PINNED_SHA_EXECUTION_REQUEST);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened", "no_action_taken_on_production",
    "no_src_modified", "no_deploy", "no_sync", "no_true", "no_file_reference"])
    assert.equal((out.pinned_sha_execution_request as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.pinned_sha_execution_request.blockers_resolved, 0);
  assert.equal(out.pinned_sha_execution_request.gates_opened, 0);
  assert.equal(out.pinned_sha_execution_request.reenable_gate, "CLOSED");
  assert.equal(out.pinned_sha_execution_request.finance_enabled, false);
  assert.equal(out.pinned_sha_execution_request.is_an_execution_approval, false);
  assert.ok(out.limitations.includes("EXECUTION_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.separate_commission.reviewed_text_prepared, true);
  assert.equal(evaluate(VERBATIM_TEXT_APPROVAL).pinned_sha_execution_request, null);
});


const ROLLBACK_PLAN_TOPIC_MESSAGE = {
  ...structuredClone(PINNED_SHA_EXECUTION_REQUEST),
  rollback_plan_topic_message: {
    operator_text: "خطة الرجوع المنفصلة**629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**",
    kind: "ROLLBACK_PLAN_NAMED_WITH_THE_REVIEWED_TEXT_SHA",
    received_in_chat: true,
    verdict: "ROLLBACK_PLAN_NAMED_BUT_NOT_PREPARED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    names_the_next_descriptive_step_explicitly: true,
    differs_from_section_95: "EXECUTION_VERB_REPLACED_BY_A_BARE_TOPIC_LABEL_THE_SHA_IS_UNCHANGED",
    sha_value: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    sha_verified: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("naming the rollback plan with the reviewed-text SHA leaves the plan unprepared", () => {
  const out = evaluate(ROLLBACK_PLAN_TOPIC_MESSAGE);
  assert.equal(out.rollback_plan_topic_message.kind,
    "ROLLBACK_PLAN_NAMED_WITH_THE_REVIEWED_TEXT_SHA");
  assert.equal(out.rollback_plan_topic_message.verdict,
    "ROLLBACK_PLAN_NAMED_BUT_NOT_PREPARED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.rollback_plan_topic_message.acknowledged_descriptively, true);
  assert.equal(out.rollback_plan_topic_message.names_the_next_descriptive_step_explicitly, true);
  assert.equal(out.rollback_plan_topic_message.differs_from_section_95,
    "EXECUTION_VERB_REPLACED_BY_A_BARE_TOPIC_LABEL_THE_SHA_IS_UNCHANGED");
  assert.equal(out.rollback_plan_topic_message.sha_verified, true);
  assert.equal(out.rollback_plan_topic_message.sha_identifies,
    "REVIEWED_TEXT_SPEC_NOT_A_ROLLBACK_PLAN");
  assert.equal(out.rollback_plan_topic_message.rollback_plan_prepared, false);
  assert.equal(out.rollback_plan_topic_message.rollback_plan_sha, null);
  assert.equal(out.rollback_plan_topic_message.no_rollback_plan_artifact_exists, true);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("a bare topic label cannot approve a plan that does not exist", () => {
  const out = evaluate(ROLLBACK_PLAN_TOPIC_MESSAGE);
  assert.equal(out.rollback_plan_topic_message.is_an_execution_approval, false);
  assert.equal(out.rollback_plan_topic_message.is_a_rollback_plan_approval, false);
  assert.equal(out.rollback_plan_topic_message.separate_rollback_plan_approval, false);
  assert.equal(out.rollback_plan_topic_message.bare_topic_label_is_not_an_explicit_separate_commission, true);
  assert.equal(out.rollback_plan_topic_message.no_commission_verb_present, true);
  assert.equal(out.rollback_plan_topic_message.next_descriptive_step,
    "SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL");
  for (const w of ["SHA_IDENTIFIES_THE_REVIEWED_TEXT_NOT_A_ROLLBACK_PLAN",
    "A_PLAN_CANNOT_BE_APPROVED_BEFORE_IT_IS_PREPARED",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "BARE_TOPIC_LABEL_IS_NOT_AN_EXPLICIT_SEPARATE_COMMISSION",
    "ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the rollback-plan topic opens no gate and changes no state", () => {
  const out = evaluate(ROLLBACK_PLAN_TOPIC_MESSAGE);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened", "no_action_taken_on_production",
    "no_src_modified", "no_deploy", "no_sync", "no_true", "no_file_reference"])
    assert.equal((out.rollback_plan_topic_message as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.rollback_plan_topic_message.blockers_resolved, 0);
  assert.equal(out.rollback_plan_topic_message.gates_opened, 0);
  assert.equal(out.rollback_plan_topic_message.reenable_gate, "CLOSED");
  assert.equal(out.rollback_plan_topic_message.finance_enabled, false);
  assert.ok(out.limitations.includes("ROLLBACK_PLAN_TOPIC_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.verbatim_text_approval.step_5_approval_received, true);
  assert.equal(evaluate(PINNED_SHA_EXECUTION_REQUEST).rollback_plan_topic_message, null);
});


const SEPARATE_ROLLBACK_PLAN_COMMISSION = {
  ...structuredClone(ROLLBACK_PLAN_TOPIC_MESSAGE),
  separate_rollback_plan_commission: {
    operator_text: "اعد خطة الرجوع المنفصلة",
    kind: "SEPARATE_EXPLICIT_COMMISSION_FOR_A_REVIEW_ONLY_ROLLBACK_PLAN",
    received_in_chat: true,
    verdict: "ROLLBACK_PLAN_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED",
    has_explicit_commission_verb: true,
    names_the_exact_next_descriptive_step: true,
    follows_the_separate_verbatim_approval: true,
    commission_scope: "ROLLBACK_PLAN_PREPARATION_ONLY",
    belongs_to_reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    acceptance_criteria_count: 6,
    rollback_plan_is_executable: false,
    rollback_plan_contains_secrets: false,
    is_an_execution_approval: false,
    separate_rollback_plan_approval: false,
    in_service_path_approval: false,
    src_and_deploy_approvals: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "OPERATOR_REVIEWS_THE_ROLLBACK_PLAN",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("the explicit separate commission prepares a pinned review-only rollback plan", () => {
  const out = evaluate(SEPARATE_ROLLBACK_PLAN_COMMISSION);
  assert.equal(out.separate_rollback_plan_commission.kind,
    "SEPARATE_EXPLICIT_COMMISSION_FOR_A_REVIEW_ONLY_ROLLBACK_PLAN");
  assert.equal(out.separate_rollback_plan_commission.verdict,
    "ROLLBACK_PLAN_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED");
  assert.equal(out.separate_rollback_plan_commission.has_explicit_commission_verb, true);
  assert.equal(out.separate_rollback_plan_commission.follows_the_separate_verbatim_approval, true);
  assert.equal(out.separate_rollback_plan_commission.commission_scope,
    "ROLLBACK_PLAN_PREPARATION_ONLY");
  assert.equal(out.separate_rollback_plan_commission.belongs_to_reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.separate_rollback_plan_commission.rollback_plan_sha, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.separate_rollback_plan_commission.acceptance_criteria_count, 6);
  assert.equal(out.separate_rollback_plan_commission.next_descriptive_step,
    "OPERATOR_REVIEWS_THE_ROLLBACK_PLAN");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the prepared rollback plan is not executable and carries no approval", () => {
  const out = evaluate(SEPARATE_ROLLBACK_PLAN_COMMISSION);
  assert.equal(out.separate_rollback_plan_commission.rollback_plan_is_executable, false);
  assert.equal(out.separate_rollback_plan_commission.rollback_plan_contains_secrets, false);
  assert.equal(out.separate_rollback_plan_commission.is_an_execution_approval, false);
  assert.equal(out.separate_rollback_plan_commission.separate_rollback_plan_approval, false);
  assert.equal(out.separate_rollback_plan_commission.in_service_path_approval, false);
  assert.equal(out.separate_rollback_plan_commission.src_and_deploy_approvals, false);
  for (const w of ["ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL_SATISFIED",
    "PINNED_ROLLBACK_PLAN_SHA_AND_SIX_ACCEPTANCE_CRITERIA",
    "NO_APPROVAL_IS_BUNDLED_WITH_THE_ROLLBACK_PLAN",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("preparing the rollback plan opens no gate and changes no state", () => {
  const out = evaluate(SEPARATE_ROLLBACK_PLAN_COMMISSION);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened", "no_action_taken_on_production",
    "no_src_modified", "no_deploy", "no_sync", "no_true"])
    assert.equal((out.separate_rollback_plan_commission as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.separate_rollback_plan_commission.blockers_resolved, 0);
  assert.equal(out.separate_rollback_plan_commission.gates_opened, 0);
  assert.equal(out.separate_rollback_plan_commission.reenable_gate, "CLOSED");
  assert.equal(out.separate_rollback_plan_commission.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("ROLLBACK_PLAN_PREPARATION_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.verbatim_text_approval.step_5_approval_received, true);
  assert.equal(evaluate(ROLLBACK_PLAN_TOPIC_MESSAGE).separate_rollback_plan_commission, null);
});


const ROLLBACK_PLAN_VERBATIM_APPROVAL = {
  ...structuredClone(SEPARATE_ROLLBACK_PLAN_COMMISSION),
  rollback_plan_verbatim_approval: {
    operator_text: "موافق علي خطه الرجوع المنفصله \n\n**3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c**",
    kind: "SEPARATE_VERBATIM_APPROVAL_OF_THE_ROLLBACK_PLAN_ONLY",
    received_in_chat: true,
    verdict: "SEPARATE_ROLLBACK_PLAN_APPROVAL_ACCEPTED_NO_GATE_OPENED",
    sha_verified: true,
    sha_matches_plan_block: true,
    sha_matches_inventory: true,
    sha_value: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    names_the_rollback_plan_explicitly: true,
    follows_pinned_rollback_plan_preparation: true,
    belongs_to_reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    approval_scope: "ROLLBACK_PLAN_TEXT_ONLY_NOT_EXECUTION",
    is_an_execution_approval: false,
    is_an_in_service_path_approval: false,
    separate_rollback_plan_approval: true,
    in_service_path_approval: false,
    src_and_deploy_approvals: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("the pinned-SHA approval of the rollback plan is verified and accepted", () => {
  const out = evaluate(ROLLBACK_PLAN_VERBATIM_APPROVAL);
  assert.equal(out.rollback_plan_verbatim_approval.kind,
    "SEPARATE_VERBATIM_APPROVAL_OF_THE_ROLLBACK_PLAN_ONLY");
  assert.equal(out.rollback_plan_verbatim_approval.verdict,
    "SEPARATE_ROLLBACK_PLAN_APPROVAL_ACCEPTED_NO_GATE_OPENED");
  assert.equal(out.rollback_plan_verbatim_approval.sha_verified, true);
  assert.equal(out.rollback_plan_verbatim_approval.sha_matches_plan_block, true);
  assert.equal(out.rollback_plan_verbatim_approval.sha_matches_inventory, true);
  assert.equal(out.rollback_plan_verbatim_approval.sha_value, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.rollback_plan_verbatim_approval.follows_pinned_rollback_plan_preparation, true);
  assert.equal(out.rollback_plan_verbatim_approval.belongs_to_reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.rollback_plan_verbatim_approval.separate_rollback_plan_approval, true);
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the plan approval scope is the review-only plan, not execution or the service path", () => {
  const out = evaluate(ROLLBACK_PLAN_VERBATIM_APPROVAL);
  assert.equal(out.rollback_plan_verbatim_approval.approval_scope,
    "ROLLBACK_PLAN_TEXT_ONLY_NOT_EXECUTION");
  assert.equal(out.rollback_plan_verbatim_approval.is_an_execution_approval, false);
  assert.equal(out.rollback_plan_verbatim_approval.is_an_in_service_path_approval, false);
  assert.equal(out.rollback_plan_verbatim_approval.in_service_path_approval, false);
  assert.equal(out.rollback_plan_verbatim_approval.src_and_deploy_approvals, false);
  assert.equal(out.rollback_plan_verbatim_approval.next_descriptive_step,
    "SEPARATE_IN_SERVICE_PATH_APPROVAL");
  for (const w of ["ROLLBACK_PLAN_SHA_VERIFIED_AGAINST_THE_PINNED_BLOCK",
    "APPROVAL_SCOPE_IS_THE_REVIEW_ONLY_PLAN_NOT_EXECUTION",
    "NO_APPROVAL_IS_BUNDLED_WITH_THE_ROLLBACK_PLAN",
    "NEXT_DESCRIPTIVE_STEP_IS_THE_SEPARATE_IN_SERVICE_PATH_APPROVAL",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the plan approval opens no gate and changes no state", () => {
  const out = evaluate(ROLLBACK_PLAN_VERBATIM_APPROVAL);
  for (const k of ["no_approval_phrase_solicited", "no_reenable_decision_solicited",
    "no_command_sent", "no_sql_delivered", "no_gate_opened", "no_action_taken_on_production",
    "no_src_modified", "no_deploy", "no_sync", "no_true"])
    assert.equal((out.rollback_plan_verbatim_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.rollback_plan_verbatim_approval.blockers_resolved, 0);
  assert.equal(out.rollback_plan_verbatim_approval.gates_opened, 0);
  assert.equal(out.rollback_plan_verbatim_approval.reenable_gate, "CLOSED");
  assert.equal(out.rollback_plan_verbatim_approval.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("ROLLBACK_PLAN_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.separate_rollback_plan_commission.rollback_plan_status,
    "ROLLBACK_PLAN_PREPARED_FOR_REVIEW_ONLY");
  assert.equal(evaluate(SEPARATE_ROLLBACK_PLAN_COMMISSION).rollback_plan_verbatim_approval, null);
});


const NEXT_STEP_QUESTION_AFTER_PLAN_APPROVAL = {
  ...structuredClone(ROLLBACK_PLAN_VERBATIM_APPROVAL),
  next_step_question_after_plan_approval: {
    operator_text: "ما الخطوه التاليه ؟",
    kind: "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    received_in_chat: true,
    verdict: "NEXT_DESCRIPTIVE_STEP_IDENTIFIED_IN_CHAT_NO_GATE_OPENED",
    answer_scope: "DESCRIPTIVE_ONLY_NO_TEMPLATE_NO_PHRASE_SOLICITED",
    current_descriptive_step: "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    current_step_index: 6,
    steps_total: 11,
    step_5_approval_received: true,
    separate_rollback_plan_approval: true,
    in_service_path_approval: false,
    src_and_deploy_approvals: false,
    execution_by: "EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("the procedural question identifies the in-service path approval as the next step", () => {
  const out = evaluate(NEXT_STEP_QUESTION_AFTER_PLAN_APPROVAL);
  assert.equal(out.next_step_question_after_plan_approval.kind,
    "PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL");
  assert.equal(out.next_step_question_after_plan_approval.verdict,
    "NEXT_DESCRIPTIVE_STEP_IDENTIFIED_IN_CHAT_NO_GATE_OPENED");
  assert.equal(out.next_step_question_after_plan_approval.current_descriptive_step,
    "SEPARATE_IN_SERVICE_PATH_APPROVAL");
  assert.equal(out.next_step_question_after_plan_approval.current_step_index, 6);
  assert.equal(out.next_step_question_after_plan_approval.steps_total, 11);
  assert.equal(out.next_step_question_after_plan_approval.step_5_approval_received, true);
  assert.equal(out.next_step_question_after_plan_approval.separate_rollback_plan_approval, true);
  assert.equal(out.next_step_question_after_plan_approval.in_service_path_approval, false);
  assert.equal(out.next_step_question_after_plan_approval.src_and_deploy_approvals, false);
  assert.equal(out.next_step_question_after_plan_approval.execution_by,
    "EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the answer is descriptive only, with no phrase and no template", () => {
  const out = evaluate(NEXT_STEP_QUESTION_AFTER_PLAN_APPROVAL);
  assert.equal(out.next_step_question_after_plan_approval.answer_scope,
    "DESCRIPTIVE_ONLY_NO_TEMPLATE_NO_PHRASE_SOLICITED");
  assert.equal(out.next_step_question_after_plan_approval.no_approval_phrase_solicited, true);
  assert.equal(out.next_step_question_after_plan_approval.no_template_delivered, true);
  assert.equal(out.next_step_question_after_plan_approval.no_reenable_decision_solicited, true);
  for (const w of ["NO_APPROVAL_PHRASE_SOLICITED_AND_NO_TEMPLATE_DELIVERED",
    "REENABLE_GATE_CLOSED_AND_DECISION_NOT_SOLICITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("identifying the next step opens no gate and changes no state", () => {
  const out = evaluate(NEXT_STEP_QUESTION_AFTER_PLAN_APPROVAL);
  for (const k of ["no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_action_taken_on_production", "no_src_modified", "no_deploy", "no_sync",
    "no_true", "no_file_reference"])
    assert.equal((out.next_step_question_after_plan_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.next_step_question_after_plan_approval.blockers_resolved, 0);
  assert.equal(out.next_step_question_after_plan_approval.gates_opened, 0);
  assert.equal(out.next_step_question_after_plan_approval.reenable_gate, "CLOSED");
  assert.equal(out.next_step_question_after_plan_approval.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("NEXT_STEP_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.rollback_plan_verbatim_approval.separate_rollback_plan_approval, true);
  assert.equal(evaluate(ROLLBACK_PLAN_VERBATIM_APPROVAL).next_step_question_after_plan_approval, null);
});


const IN_SERVICE_PATH_TOPIC_MESSAGE = {
  ...structuredClone(NEXT_STEP_QUESTION_AFTER_PLAN_APPROVAL),
  in_service_path_topic_message: {
    operator_text: "إدخال مسار الفحص داخل العملية",
    kind: "IN_SERVICE_PATH_TOPIC_NAMED_NOT_AN_APPROVAL",
    received_in_chat: true,
    verdict: "IN_SERVICE_PATH_TOPIC_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    names_the_step_6_subject_explicitly: true,
    differs_from_section_99: "TOPIC_NAMED_WITHOUT_APPROVAL_VERB_OR_PINNED_SHA",
    is_a_bare_noun_phrase: true,
    is_an_explicit_verbatim_approval: false,
    references_pinned_sha: false,
    reviewed_text_sha_expected: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha_expected: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    bare_noun_phrase_is_not_an_explicit_approval: true,
    implicit_execution_intent_not_an_authorization: true,
    separate_in_service_path_approval_missing: true,
    src_and_deploy_approvals_missing: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("naming the in-service path subject is acknowledged descriptively", () => {
  const out = evaluate(IN_SERVICE_PATH_TOPIC_MESSAGE);
  assert.equal(out.in_service_path_topic_message.kind,
    "IN_SERVICE_PATH_TOPIC_NAMED_NOT_AN_APPROVAL");
  assert.equal(out.in_service_path_topic_message.verdict,
    "IN_SERVICE_PATH_TOPIC_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.in_service_path_topic_message.acknowledged_descriptively, true);
  assert.equal(out.in_service_path_topic_message.names_the_step_6_subject_explicitly, true);
  assert.equal(out.in_service_path_topic_message.differs_from_section_99,
    "TOPIC_NAMED_WITHOUT_APPROVAL_VERB_OR_PINNED_SHA");
  assert.equal(out.in_service_path_topic_message.is_a_bare_noun_phrase, true);
  assert.equal(out.in_service_path_topic_message.next_descriptive_step,
    "SEPARATE_IN_SERVICE_PATH_APPROVAL");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the topic message is not a verbatim approval and carries no pinned SHA", () => {
  const out = evaluate(IN_SERVICE_PATH_TOPIC_MESSAGE);
  assert.equal(out.in_service_path_topic_message.is_an_explicit_verbatim_approval, false);
  assert.equal(out.in_service_path_topic_message.references_pinned_sha, false);
  assert.equal(out.in_service_path_topic_message.reviewed_text_sha_expected,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.in_service_path_topic_message.rollback_plan_sha_expected,
    "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.in_service_path_topic_message.bare_noun_phrase_is_not_an_explicit_approval, true);
  assert.equal(out.in_service_path_topic_message.implicit_execution_intent_not_an_authorization, true);
  assert.equal(out.in_service_path_topic_message.is_an_execution_approval, false);
  assert.equal(out.in_service_path_topic_message.in_service_path_approval, false);
  assert.equal(out.in_service_path_topic_message.src_and_deploy_approvals, false);
  for (const w of ["BARE_NOUN_PHRASE_IS_NOT_A_SEPARATE_VERBATIM_APPROVAL",
    "NO_PINNED_SHA_IN_THE_MESSAGE", "DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH",
    "SEPARATE_IN_SERVICE_PATH_APPROVAL_IS_STILL_MISSING",
    "SRC_AND_DEPLOY_APPROVALS_ARE_STILL_MISSING",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the topic message changes no source, opens no gate, and changes no state", () => {
  const out = evaluate(IN_SERVICE_PATH_TOPIC_MESSAGE);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_deploy", "no_sync", "no_true", "no_file_reference"])
    assert.equal((out.in_service_path_topic_message as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.in_service_path_topic_message.blockers_resolved, 0);
  assert.equal(out.in_service_path_topic_message.gates_opened, 0);
  assert.equal(out.in_service_path_topic_message.reenable_gate, "CLOSED");
  assert.equal(out.in_service_path_topic_message.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("IN_SERVICE_PATH_TOPIC_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.rollback_plan_verbatim_approval.separate_rollback_plan_approval, true);
  assert.equal(evaluate(NEXT_STEP_QUESTION_AFTER_PLAN_APPROVAL).in_service_path_topic_message, null);
});


const IN_SERVICE_PATH_PINNED_SHAS_MESSAGE = {
  ...structuredClone(IN_SERVICE_PATH_TOPIC_MESSAGE),
  in_service_path_pinned_shas_message: {
    operator_text: "إدخال مسار الفحص داخل العملية\n\n**3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c**\n\n**629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**",
    kind: "IN_SERVICE_PATH_NAMED_WITH_BOTH_PINNED_SHAS_NOT_AN_APPROVAL",
    received_in_chat: true,
    verdict: "BOTH_PINNED_SHAS_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    names_the_step_6_subject_explicitly: true,
    differs_from_section_100: "BOTH_PINNED_SHAS_ADDED_BUT_NO_APPROVAL_VERB_AND_NO_SRC_DEPLOY_APPROVALS",
    references_pinned_sha: true,
    both_shas_present: true,
    both_shas_verified: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    is_a_bare_noun_phrase: true,
    is_an_explicit_verbatim_approval: false,
    is_an_execution_approval: false,
    implicit_execution_intent_not_an_authorization: true,
    sha_alone_is_not_an_execution_authorization: true,
    separate_in_service_path_approval_missing: true,
    src_and_deploy_approvals_missing: true,
    no_blanket_approval: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("both pinned SHAs are verified but only acknowledged descriptively", () => {
  const out = evaluate(IN_SERVICE_PATH_PINNED_SHAS_MESSAGE);
  assert.equal(out.in_service_path_pinned_shas_message.kind,
    "IN_SERVICE_PATH_NAMED_WITH_BOTH_PINNED_SHAS_NOT_AN_APPROVAL");
  assert.equal(out.in_service_path_pinned_shas_message.verdict,
    "BOTH_PINNED_SHAS_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.in_service_path_pinned_shas_message.both_shas_verified, true);
  assert.equal(out.in_service_path_pinned_shas_message.reviewed_text_sha, "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.in_service_path_pinned_shas_message.rollback_plan_sha, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.in_service_path_pinned_shas_message.differs_from_section_100,
    "BOTH_PINNED_SHAS_ADDED_BUT_NO_APPROVAL_VERB_AND_NO_SRC_DEPLOY_APPROVALS");
  assert.equal(out.in_service_path_pinned_shas_message.next_descriptive_step,
    "SEPARATE_IN_SERVICE_PATH_APPROVAL");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("SHAs identify but do not authorize the in-service path or any src change", () => {
  const out = evaluate(IN_SERVICE_PATH_PINNED_SHAS_MESSAGE);
  assert.equal(out.in_service_path_pinned_shas_message.is_an_explicit_verbatim_approval, false);
  assert.equal(out.in_service_path_pinned_shas_message.is_an_execution_approval, false);
  assert.equal(out.in_service_path_pinned_shas_message.sha_alone_is_not_an_execution_authorization, true);
  assert.equal(out.in_service_path_pinned_shas_message.implicit_execution_intent_not_an_authorization, true);
  assert.equal(out.in_service_path_pinned_shas_message.separate_in_service_path_approval_missing, true);
  assert.equal(out.in_service_path_pinned_shas_message.src_and_deploy_approvals_missing, true);
  assert.equal(out.in_service_path_pinned_shas_message.in_service_path_approval, false);
  assert.equal(out.in_service_path_pinned_shas_message.src_and_deploy_approvals, false);
  for (const w of ["BOTH_PINNED_SHAS_VERIFIED_AGAINST_THE_BLOCKS_AND_INVENTORY",
    "SHAS_IDENTIFY_BUT_DO_NOT_AUTHORIZE_EXECUTION",
    "DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH",
    "SEPARATE_IN_SERVICE_PATH_APPROVAL_IS_STILL_MISSING",
    "SRC_AND_DEPLOY_APPROVALS_ARE_STILL_MISSING", "NO_BLANKET_APPROVAL",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the pinned-SHAs message changes no source, opens no gate, and changes no state", () => {
  const out = evaluate(IN_SERVICE_PATH_PINNED_SHAS_MESSAGE);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_deploy", "no_sync", "no_true", "no_file_reference"])
    assert.equal((out.in_service_path_pinned_shas_message as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.in_service_path_pinned_shas_message.blockers_resolved, 0);
  assert.equal(out.in_service_path_pinned_shas_message.gates_opened, 0);
  assert.equal(out.in_service_path_pinned_shas_message.reenable_gate, "CLOSED");
  assert.equal(out.in_service_path_pinned_shas_message.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("PINNED_SHAS_MESSAGE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(out.in_service_path_topic_message.references_pinned_sha, false);
  assert.equal(evaluate(IN_SERVICE_PATH_TOPIC_MESSAGE).in_service_path_pinned_shas_message, null);
});


const BUNDLED_PATH_SRC_DEPLOY_APPROVAL = {
  ...structuredClone(IN_SERVICE_PATH_PINNED_SHAS_MESSAGE),
  bundled_path_src_deploy_approval: {
    operator_text: "موافق علي إدخال مسار الفحص داخل العملية  وموافق `src` ونشر إن لزم\n\n**3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c**\n\n**629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**",
    kind: "BUNDLED_IN_SERVICE_PATH_SRC_AND_DEPLOY_APPROVAL_NOT_SEPARATE",
    received_in_chat: true,
    verdict: "BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    differs_from_section_101: "APPROVAL_VERB_ADDED_AND_SRC_DEPLOY_APPROVALS_BUNDLED_BUT_NO_SEPARATE_VERBATIM_APPROVAL",
    approval_verb_present: true,
    references_pinned_sha: true,
    both_shas_verified: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    bundles_three_approvals_in_one_message: true,
    includes_in_service_path_approval: true,
    includes_src_approval: true,
    includes_deploy_approval: true,
    is_a_separate_verbatim_approval: false,
    no_blanket_approval: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    in_service_path_approval: false,
    src_and_deploy_approvals: false,
    is_an_execution_approval: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("bundling the path, src and deploy approvals is refused outright", () => {
  const out = evaluate(BUNDLED_PATH_SRC_DEPLOY_APPROVAL);
  assert.equal(out.bundled_path_src_deploy_approval.kind,
    "BUNDLED_IN_SERVICE_PATH_SRC_AND_DEPLOY_APPROVAL_NOT_SEPARATE");
  assert.equal(out.bundled_path_src_deploy_approval.verdict,
    "BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.bundled_path_src_deploy_approval.approval_verb_present, true);
  assert.equal(out.bundled_path_src_deploy_approval.both_shas_verified, true);
  assert.equal(out.bundled_path_src_deploy_approval.bundles_three_approvals_in_one_message, true);
  assert.equal(out.bundled_path_src_deploy_approval.is_a_separate_verbatim_approval, false);
  assert.equal(out.bundled_path_src_deploy_approval.differs_from_section_101,
    "APPROVAL_VERB_ADDED_AND_SRC_DEPLOY_APPROVALS_BUNDLED_BUT_NO_SEPARATE_VERBATIM_APPROVAL");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("src modification and deploy remain prohibited despite the approval words", () => {
  const out = evaluate(BUNDLED_PATH_SRC_DEPLOY_APPROVAL);
  assert.equal(out.bundled_path_src_deploy_approval.includes_src_approval, true);
  assert.equal(out.bundled_path_src_deploy_approval.includes_deploy_approval, true);
  assert.equal(out.bundled_path_src_deploy_approval.src_modification_is_prohibited, true);
  assert.equal(out.bundled_path_src_deploy_approval.deploy_is_prohibited, true);
  assert.equal(out.bundled_path_src_deploy_approval.in_service_path_approval, false);
  assert.equal(out.bundled_path_src_deploy_approval.src_and_deploy_approvals, false);
  assert.equal(out.bundled_path_src_deploy_approval.is_an_execution_approval, false);
  assert.equal(out.bundled_path_src_deploy_approval.next_descriptive_step,
    "SEPARATE_IN_SERVICE_PATH_APPROVAL");
  for (const w of ["NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "BOTH_PINNED_SHAS_VERIFIED_BUT_BUNDLING_STILL_REFUSED",
    "SRC_MODIFICATION_AND_DEPLOY_ARE_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the bundled message opens no gate and changes no state", () => {
  const out = evaluate(BUNDLED_PATH_SRC_DEPLOY_APPROVAL);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.bundled_path_src_deploy_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.bundled_path_src_deploy_approval.blockers_resolved, 0);
  assert.equal(out.bundled_path_src_deploy_approval.gates_opened, 0);
  assert.equal(out.bundled_path_src_deploy_approval.reenable_gate, "CLOSED");
  assert.equal(out.bundled_path_src_deploy_approval.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("BUNDLED_APPROVAL_MESSAGE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(IN_SERVICE_PATH_PINNED_SHAS_MESSAGE).bundled_path_src_deploy_approval, null);
});


const MULTI_LINE_BUNDLED_APPROVALS = {
  ...structuredClone(BUNDLED_PATH_SRC_DEPLOY_APPROVAL),
  multi_line_bundled_approvals: {
    operator_text: "موافق علي إدخال مسار الفحص داخل العملية\n\n  وموافق علي `src`\n\n وموافق علي النشر\n\n**3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c**\n\n**629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**",
    kind: "MULTI_LINE_BUNDLED_APPROVALS_STILL_ONE_SINGLE_CHAT_MESSAGE",
    received_in_chat: true,
    verdict: "MULTI_LINE_BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    differs_from_section_102: "THREE_APPROVAL_VERBS_ON_SEPARATE_LINES_BUT_STILL_ONE_SINGLE_CHAT_MESSAGE",
    three_approval_verbs_on_separate_lines: true,
    is_one_single_chat_message: true,
    is_three_separate_messages: false,
    references_pinned_sha: true,
    both_shas_verified: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    includes_in_service_path_approval: true,
    includes_src_approval: true,
    includes_deploy_approval: true,
    is_a_separate_verbatim_approval: false,
    no_blanket_approval: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    in_service_path_approval: false,
    src_and_deploy_approvals: false,
    is_an_execution_approval: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_IN_SERVICE_PATH_APPROVAL",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("three approval verbs on separate lines are still one bundled message", () => {
  const out = evaluate(MULTI_LINE_BUNDLED_APPROVALS);
  assert.equal(out.multi_line_bundled_approvals.kind,
    "MULTI_LINE_BUNDLED_APPROVALS_STILL_ONE_SINGLE_CHAT_MESSAGE");
  assert.equal(out.multi_line_bundled_approvals.verdict,
    "MULTI_LINE_BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.multi_line_bundled_approvals.three_approval_verbs_on_separate_lines, true);
  assert.equal(out.multi_line_bundled_approvals.is_one_single_chat_message, true);
  assert.equal(out.multi_line_bundled_approvals.is_three_separate_messages, false);
  assert.equal(out.multi_line_bundled_approvals.differs_from_section_102,
    "THREE_APPROVAL_VERBS_ON_SEPARATE_LINES_BUT_STILL_ONE_SINGLE_CHAT_MESSAGE");
  assert.equal(out.multi_line_bundled_approvals.both_shas_verified, true);
  assert.equal(out.multi_line_bundled_approvals.is_a_separate_verbatim_approval, false);
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("src and deploy remain prohibited and no path approval is implied", () => {
  const out = evaluate(MULTI_LINE_BUNDLED_APPROVALS);
  assert.equal(out.multi_line_bundled_approvals.includes_src_approval, true);
  assert.equal(out.multi_line_bundled_approvals.includes_deploy_approval, true);
  assert.equal(out.multi_line_bundled_approvals.src_modification_is_prohibited, true);
  assert.equal(out.multi_line_bundled_approvals.deploy_is_prohibited, true);
  assert.equal(out.multi_line_bundled_approvals.in_service_path_approval, false);
  assert.equal(out.multi_line_bundled_approvals.src_and_deploy_approvals, false);
  assert.equal(out.multi_line_bundled_approvals.next_descriptive_step,
    "SEPARATE_IN_SERVICE_PATH_APPROVAL");
  for (const w of ["SEPARATE_LINES_DO_NOT_CREATE_SEPARATE_STANDALONE_MESSAGES",
    "NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "BOTH_PINNED_SHAS_VERIFIED_BUT_BUNDLING_STILL_REFUSED",
    "SRC_MODIFICATION_AND_DEPLOY_ARE_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the multi-line bundled message opens no gate and changes no state", () => {
  const out = evaluate(MULTI_LINE_BUNDLED_APPROVALS);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.multi_line_bundled_approvals as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.multi_line_bundled_approvals.blockers_resolved, 0);
  assert.equal(out.multi_line_bundled_approvals.gates_opened, 0);
  assert.equal(out.multi_line_bundled_approvals.reenable_gate, "CLOSED");
  assert.equal(out.multi_line_bundled_approvals.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("MULTI_LINE_BUNDLED_APPROVALS_DO_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(BUNDLED_PATH_SRC_DEPLOY_APPROVAL).multi_line_bundled_approvals, null);
});


const SEPARATE_IN_SERVICE_PATH_APPROVAL = {
  ...structuredClone(MULTI_LINE_BUNDLED_APPROVALS),
  separate_in_service_path_approval: {
    operator_text: "موافق علي إدخال مسار الفحص **629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**\n\n داخل العمليه**3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c**",
    kind: "SEPARATE_VERBATIM_APPROVAL_OF_THE_IN_SERVICE_PATH_ONLY",
    received_in_chat: true,
    verdict: "SEPARATE_IN_SERVICE_PATH_APPROVAL_ACCEPTED_NO_GATE_OPENED",
    differs_from_section_103: "SINGLE_APPROVAL_ON_THE_IN_SERVICE_PATH_ONLY_WITH_BOTH_PINNED_SHAS_NO_SRC_NO_DEPLOY",
    is_one_single_standalone_message: true,
    is_a_single_approval: true,
    approval_verb_present: true,
    names_the_in_service_path_explicitly: true,
    references_pinned_sha: true,
    both_shas_verified: true,
    shas_embedded_inline: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    follows_step_5_and_rollback_plan_approvals: true,
    approval_scope: "IN_SERVICE_PATH_ONLY_NOT_SRC_NOT_DEPLOY_NOT_EXECUTION",
    is_an_execution_approval: false,
    is_a_src_approval: false,
    is_a_deploy_approval: false,
    separate_in_service_path_approval: true,
    src_and_deploy_approvals: false,
    no_blanket_approval: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("one standalone in-service path approval with both pinned SHAs is accepted", () => {
  const out = evaluate(SEPARATE_IN_SERVICE_PATH_APPROVAL);
  assert.equal(out.separate_in_service_path_approval.kind,
    "SEPARATE_VERBATIM_APPROVAL_OF_THE_IN_SERVICE_PATH_ONLY");
  assert.equal(out.separate_in_service_path_approval.verdict,
    "SEPARATE_IN_SERVICE_PATH_APPROVAL_ACCEPTED_NO_GATE_OPENED");
  assert.equal(out.separate_in_service_path_approval.is_one_single_standalone_message, true);
  assert.equal(out.separate_in_service_path_approval.is_a_single_approval, true);
  assert.equal(out.separate_in_service_path_approval.both_shas_verified, true);
  assert.equal(out.separate_in_service_path_approval.reviewed_text_sha, "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.separate_in_service_path_approval.rollback_plan_sha, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.separate_in_service_path_approval.follows_step_5_and_rollback_plan_approvals, true);
  assert.equal(out.separate_in_service_path_approval.separate_in_service_path_approval, true);
  assert.equal(out.separate_in_service_path_approval.differs_from_section_103,
    "SINGLE_APPROVAL_ON_THE_IN_SERVICE_PATH_ONLY_WITH_BOTH_PINNED_SHAS_NO_SRC_NO_DEPLOY");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the accepted scope excludes src, deploy and execution", () => {
  const out = evaluate(SEPARATE_IN_SERVICE_PATH_APPROVAL);
  assert.equal(out.separate_in_service_path_approval.approval_scope,
    "IN_SERVICE_PATH_ONLY_NOT_SRC_NOT_DEPLOY_NOT_EXECUTION");
  assert.equal(out.separate_in_service_path_approval.is_an_execution_approval, false);
  assert.equal(out.separate_in_service_path_approval.is_a_src_approval, false);
  assert.equal(out.separate_in_service_path_approval.is_a_deploy_approval, false);
  assert.equal(out.separate_in_service_path_approval.src_and_deploy_approvals, false);
  assert.equal(out.separate_in_service_path_approval.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["ONE_STANDALONE_APPROVAL_WITH_BOTH_PINNED_SHAS_INLINE",
    "APPROVAL_SCOPE_IS_THE_IN_SERVICE_PATH_ONLY_NOT_SRC_NOT_DEPLOY_NOT_EXECUTION",
    "SRC_AND_DEPLOY_APPROVALS_ARE_STILL_MISSING", "NO_BLANKET_APPROVAL",
    "EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the accepted path approval opens no gate and changes no state", () => {
  const out = evaluate(SEPARATE_IN_SERVICE_PATH_APPROVAL);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.separate_in_service_path_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.separate_in_service_path_approval.blockers_resolved, 0);
  assert.equal(out.separate_in_service_path_approval.gates_opened, 0);
  assert.equal(out.separate_in_service_path_approval.reenable_gate, "CLOSED");
  assert.equal(out.separate_in_service_path_approval.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("SEPARATE_IN_SERVICE_PATH_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(MULTI_LINE_BUNDLED_APPROVALS).separate_in_service_path_approval, null);
});


const STANDALONE_SRC_ONLY_APPROVAL = {
  ...structuredClone(SEPARATE_IN_SERVICE_PATH_APPROVAL),
  standalone_src_only_approval: {
    operator_text: "موافق علي `src`",
    kind: "SRC_ONLY_APPROVAL_WITHOUT_A_PINNED_REVIEWED_TEXT",
    received_in_chat: true,
    verdict: "SRC_ONLY_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    is_one_single_standalone_message: true,
    is_a_single_approval: true,
    differs_from_section_104: "SINGLE_APPROVAL_BUT_NAMES_SRC_NOT_A_PINNED_REVIEWED_TEXT_AND_HAS_NO_SHA",
    approval_verb_present: true,
    references_pinned_sha: false,
    no_pinned_sha_in_message: true,
    reviewed_text_sha_expected: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha_expected: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    no_reviewed_text_for_src_changes: true,
    no_acceptance_criteria_for_src_changes: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    is_an_execution_approval: false,
    separate_in_service_path_approval: true,
    src_and_deploy_approvals: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a standalone src-only approval is refused because no pinned reviewed text exists", () => {
  const out = evaluate(STANDALONE_SRC_ONLY_APPROVAL);
  assert.equal(out.standalone_src_only_approval.kind,
    "SRC_ONLY_APPROVAL_WITHOUT_A_PINNED_REVIEWED_TEXT");
  assert.equal(out.standalone_src_only_approval.verdict,
    "SRC_ONLY_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.standalone_src_only_approval.is_one_single_standalone_message, true);
  assert.equal(out.standalone_src_only_approval.is_a_single_approval, true);
  assert.equal(out.standalone_src_only_approval.references_pinned_sha, false);
  assert.equal(out.standalone_src_only_approval.no_reviewed_text_for_src_changes, true);
  assert.equal(out.standalone_src_only_approval.no_acceptance_criteria_for_src_changes, true);
  assert.equal(out.standalone_src_only_approval.differs_from_section_104,
    "SINGLE_APPROVAL_BUT_NAMES_SRC_NOT_A_PINNED_REVIEWED_TEXT_AND_HAS_NO_SHA");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("src modification and deploy stay prohibited and no approval is implied", () => {
  const out = evaluate(STANDALONE_SRC_ONLY_APPROVAL);
  assert.equal(out.standalone_src_only_approval.src_modification_is_prohibited, true);
  assert.equal(out.standalone_src_only_approval.deploy_is_prohibited, true);
  assert.equal(out.standalone_src_only_approval.is_an_execution_approval, false);
  assert.equal(out.standalone_src_only_approval.separate_in_service_path_approval, true);
  assert.equal(out.standalone_src_only_approval.src_and_deploy_approvals, false);
  assert.equal(out.standalone_src_only_approval.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["NO_PINNED_SHA_IN_THE_MESSAGE",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the src-only approval opens no gate and changes no state", () => {
  const out = evaluate(STANDALONE_SRC_ONLY_APPROVAL);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.standalone_src_only_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.standalone_src_only_approval.blockers_resolved, 0);
  assert.equal(out.standalone_src_only_approval.gates_opened, 0);
  assert.equal(out.standalone_src_only_approval.reenable_gate, "CLOSED");
  assert.equal(out.standalone_src_only_approval.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("SRC_ONLY_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(SEPARATE_IN_SERVICE_PATH_APPROVAL).standalone_src_only_approval, null);
});


const STALE_SHA_SRC_APPROVAL = {
  ...structuredClone(STANDALONE_SRC_ONLY_APPROVAL),
  stale_sha_src_approval: {
    operator_text: "وموافق علي `src`\n\n```\nd960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb\n```",
    kind: "SRC_APPROVAL_PINNED_TO_AN_OLD_UNRELATED_PROBE_SHA",
    received_in_chat: true,
    verdict: "STALE_SHA_SRC_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    is_one_single_standalone_message: true,
    is_a_single_approval: true,
    differs_from_section_105: "AN_OLD_PROBE_SHA_WAS_ADDED_BUT_NO_SRC_REVIEWED_TEXT_EXISTS",
    approval_verb_present: true,
    references_pinned_sha: false,
    no_current_pinned_sha: true,
    unrelated_sha_present: true,
    unrelated_sha_value: "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb",
    unrelated_sha_identifies: "APP_CONNECTION_PROBE_V1_1_READ_ONLY_SQL",
    unrelated_sha_matches_probe_file: true,
    reviewed_text_sha_expected: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha_expected: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    no_reviewed_text_for_src_changes: true,
    no_acceptance_criteria_for_src_changes: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    is_an_execution_approval: false,
    separate_in_service_path_approval: true,
    src_and_deploy_approvals: false,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("an old unrelated probe SHA cannot pin a src approval", () => {
  const out = evaluate(STALE_SHA_SRC_APPROVAL);
  assert.equal(out.stale_sha_src_approval.kind,
    "SRC_APPROVAL_PINNED_TO_AN_OLD_UNRELATED_PROBE_SHA");
  assert.equal(out.stale_sha_src_approval.verdict,
    "STALE_SHA_SRC_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.stale_sha_src_approval.references_pinned_sha, false);
  assert.equal(out.stale_sha_src_approval.unrelated_sha_identifies,
    "APP_CONNECTION_PROBE_V1_1_READ_ONLY_SQL");
  assert.equal(out.stale_sha_src_approval.unrelated_sha_matches_probe_file, true);
  assert.equal(out.stale_sha_src_approval.no_reviewed_text_for_src_changes, true);
  assert.equal(out.stale_sha_src_approval.differs_from_section_105,
    "AN_OLD_PROBE_SHA_WAS_ADDED_BUT_NO_SRC_REVIEWED_TEXT_EXISTS");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the stale SHA does not waive the src prohibition or imply an approval", () => {
  const out = evaluate(STALE_SHA_SRC_APPROVAL);
  assert.equal(out.stale_sha_src_approval.src_modification_is_prohibited, true);
  assert.equal(out.stale_sha_src_approval.deploy_is_prohibited, true);
  assert.equal(out.stale_sha_src_approval.is_an_execution_approval, false);
  assert.equal(out.stale_sha_src_approval.separate_in_service_path_approval, true);
  assert.equal(out.stale_sha_src_approval.src_and_deploy_approvals, false);
  assert.equal(out.stale_sha_src_approval.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["OLD_UNRELATED_PROBE_SHA_IS_NOT_A_CURRENT_PINNED_TEXT",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the stale SHA message opens no gate and changes no state", () => {
  const out = evaluate(STALE_SHA_SRC_APPROVAL);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.stale_sha_src_approval as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.stale_sha_src_approval.blockers_resolved, 0);
  assert.equal(out.stale_sha_src_approval.gates_opened, 0);
  assert.equal(out.stale_sha_src_approval.reenable_gate, "CLOSED");
  assert.equal(out.stale_sha_src_approval.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("STALE_SHA_SRC_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(STANDALONE_SRC_ONLY_APPROVAL).stale_sha_src_approval, null);
});


const SRC_MODIFICATION_APPROVAL_WITH_CURRENT_SHAS = {
  ...structuredClone(STALE_SHA_SRC_APPROVAL),
  src_modification_approval_with_current_shas: {
    operator_text: "موافق علي التعديل  علي `src`\n\n**629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e**\n\n**3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c**",
    kind: "SRC_MODIFICATION_APPROVAL_WITH_CURRENT_BUT_UNRELATED_SHAS",
    received_in_chat: true,
    verdict: "SRC_MODIFICATION_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    is_one_single_standalone_message: true,
    is_a_single_approval: true,
    approval_verb_present: true,
    differs_from_section_106: "BOTH_CURRENT_PINNED_SHAS_USED_BUT_THEY_IDENTIFY_OTHER_ARTIFACTS_NOT_A_SRC_TEXT",
    both_current_shas_present: true,
    both_current_shas_verified: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    shas_identify: "IN_SERVICE_REVIEWED_TEXT_AND_ROLLBACK_PLAN_NOT_A_SRC_ARTIFACT",
    no_reviewed_text_for_src_changes: true,
    no_acceptance_criteria_for_src_changes: true,
    no_src_artifact_sha: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    is_an_execution_approval: false,
    separate_in_service_path_approval: true,
    src_and_deploy_approvals: false,
    no_blanket_approval: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("current pinned SHAs on a src modification approval identify other artifacts", () => {
  const out = evaluate(SRC_MODIFICATION_APPROVAL_WITH_CURRENT_SHAS);
  assert.equal(out.src_modification_approval_with_current_shas.kind,
    "SRC_MODIFICATION_APPROVAL_WITH_CURRENT_BUT_UNRELATED_SHAS");
  assert.equal(out.src_modification_approval_with_current_shas.verdict,
    "SRC_MODIFICATION_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.src_modification_approval_with_current_shas.both_current_shas_verified, true);
  assert.equal(out.src_modification_approval_with_current_shas.reviewed_text_sha, "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.src_modification_approval_with_current_shas.rollback_plan_sha, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.src_modification_approval_with_current_shas.shas_identify,
    "IN_SERVICE_REVIEWED_TEXT_AND_ROLLBACK_PLAN_NOT_A_SRC_ARTIFACT");
  assert.equal(out.src_modification_approval_with_current_shas.differs_from_section_106,
    "BOTH_CURRENT_PINNED_SHAS_USED_BUT_THEY_IDENTIFY_OTHER_ARTIFACTS_NOT_A_SRC_TEXT");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("no reviewed src text exists and src modification stays prohibited", () => {
  const out = evaluate(SRC_MODIFICATION_APPROVAL_WITH_CURRENT_SHAS);
  assert.equal(out.src_modification_approval_with_current_shas.no_reviewed_text_for_src_changes, true);
  assert.equal(out.src_modification_approval_with_current_shas.no_acceptance_criteria_for_src_changes, true);
  assert.equal(out.src_modification_approval_with_current_shas.no_src_artifact_sha, true);
  assert.equal(out.src_modification_approval_with_current_shas.src_modification_is_prohibited, true);
  assert.equal(out.src_modification_approval_with_current_shas.deploy_is_prohibited, true);
  assert.equal(out.src_modification_approval_with_current_shas.is_an_execution_approval, false);
  assert.equal(out.src_modification_approval_with_current_shas.src_and_deploy_approvals, false);
  assert.equal(out.src_modification_approval_with_current_shas.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["BOTH_CURRENT_PINNED_SHAS_VERIFIED_BUT_THEY_IDENTIFY_OTHER_ARTIFACTS",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the src modification approval opens no gate and changes no state", () => {
  const out = evaluate(SRC_MODIFICATION_APPROVAL_WITH_CURRENT_SHAS);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.src_modification_approval_with_current_shas as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.src_modification_approval_with_current_shas.blockers_resolved, 0);
  assert.equal(out.src_modification_approval_with_current_shas.gates_opened, 0);
  assert.equal(out.src_modification_approval_with_current_shas.reenable_gate, "CLOSED");
  assert.equal(out.src_modification_approval_with_current_shas.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("SRC_MODIFICATION_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(STALE_SHA_SRC_APPROVAL).src_modification_approval_with_current_shas, null);
});


const RATIFICATION_OF_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY = {
  ...structuredClone(SRC_MODIFICATION_APPROVAL_WITH_CURRENT_SHAS),
  approval_of_prior_refused_src_approval_bundled_with_deploy: {
    operator_text: "اوافق علي  موافقتي `src` ونشر إن لزم",
    kind: "APPROVAL_OF_A_PRIOR_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY",
    received_in_chat: true,
    verdict: "RATIFICATION_OF_REFUSED_SRC_APPROVAL_AND_DEPLOY_BUNDLE_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    is_one_single_standalone_message: true,
    is_a_single_approval: false,
    approval_verb_present: true,
    differs_from_section_107: "NO_PINNED_SHAS_AND_A_SECOND_APPROVAL_TARGET_DEPLOY_IS_BUNDLED_WITH_A_REFUSED_SRC_APPROVAL",
    ratifies_a_prior_refused_approval: true,
    prior_refused_sections: [105, 106, 107],
    bundles_deploy_with_src: true,
    conditional_deploy_wording: "ونشر إن لزم",
    is_a_separate_verbatim_approval: false,
    references_pinned_sha: false,
    no_pinned_sha_in_message: true,
    no_reviewed_text_for_src_changes: true,
    no_acceptance_criteria_for_src_changes: true,
    no_src_artifact_sha: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    is_an_execution_approval: false,
    separate_in_service_path_approval: true,
    src_and_deploy_approvals: false,
    no_blanket_approval: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("ratifying a refused src approval with a deploy bundle is refused", () => {
  const out = evaluate(RATIFICATION_OF_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.kind,
    "APPROVAL_OF_A_PRIOR_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY");
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.verdict,
    "RATIFICATION_OF_REFUSED_SRC_APPROVAL_AND_DEPLOY_BUNDLE_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.ratifies_a_prior_refused_approval, true);
  assert.deepEqual(out.approval_of_prior_refused_src_approval_bundled_with_deploy.prior_refused_sections, [105, 106, 107]);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.bundles_deploy_with_src, true);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.conditional_deploy_wording, "ونشر إن لزم");
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.is_a_separate_verbatim_approval, false);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.differs_from_section_107,
    "NO_PINNED_SHAS_AND_A_SECOND_APPROVAL_TARGET_DEPLOY_IS_BUNDLED_WITH_A_REFUSED_SRC_APPROVAL");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("ratification does not cure a refused approval and deploy stays prohibited", () => {
  const out = evaluate(RATIFICATION_OF_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.no_pinned_sha_in_message, true);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.no_reviewed_text_for_src_changes, true);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.no_src_artifact_sha, true);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.src_modification_is_prohibited, true);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.deploy_is_prohibited, true);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.is_an_execution_approval, false);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.src_and_deploy_approvals, false);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["A_REFUSED_APPROVAL_CANNOT_BE_RATIFIED_INTO_A_VALID_ONE",
    "NO_PINNED_SHA_IN_MESSAGE",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the ratification and deploy bundle opens no gate and changes no state", () => {
  const out = evaluate(RATIFICATION_OF_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.approval_of_prior_refused_src_approval_bundled_with_deploy as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.blockers_resolved, 0);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.gates_opened, 0);
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.reenable_gate, "CLOSED");
  assert.equal(out.approval_of_prior_refused_src_approval_bundled_with_deploy.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("RATIFICATION_AND_DEPLOY_BUNDLE_DO_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(SRC_MODIFICATION_APPROVAL_WITH_CURRENT_SHAS).approval_of_prior_refused_src_approval_bundled_with_deploy, null);
});


const OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_SHAS = {
  ...structuredClone(RATIFICATION_OF_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY),
  old_request_migration_label_with_current_shas: {
    operator_text: "***ترحيل الطلب القديم***\n\n```\n'629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e' '3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c' \n\n```",
    kind: "OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_PINNED_SHAS",
    received_in_chat: true,
    verdict: "OLD_REQUEST_MIGRATION_LABEL_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    is_one_single_standalone_message: true,
    differs_from_section_108: "A_MIGRATION_LABEL_WITH_TWO_CURRENT_SHAS_NOT_A_RATIFICATION_AND_DEPLOY_BUNDLE",
    is_a_label_not_an_approval: true,
    approval_verb_present: false,
    is_a_separate_verbatim_approval: false,
    both_current_shas_present: true,
    both_current_shas_verified: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    shas_identify: "IN_SERVICE_REVIEWED_TEXT_AND_ROLLBACK_PLAN_NOT_A_MIGRATION_RECORD",
    quoted_shas_in_a_code_block: true,
    no_migration_performed: true,
    migration_is_not_a_session_action: true,
    session_does_not_migrate_or_revalidate_a_refused_request: true,
    no_reviewed_text_for_src_changes: true,
    no_acceptance_criteria_for_src_changes: true,
    no_src_artifact_sha: true,
    no_src_target_in_message: true,
    no_deploy_target_in_message: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    is_an_execution_approval: false,
    separate_in_service_path_approval: true,
    src_and_deploy_approvals: false,
    no_blanket_approval: true,
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_inventory_change: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a migration label with current SHAs is not an approval", () => {
  const out = evaluate(OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_SHAS);
  assert.equal(out.old_request_migration_label_with_current_shas.kind,
    "OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_PINNED_SHAS");
  assert.equal(out.old_request_migration_label_with_current_shas.verdict,
    "OLD_REQUEST_MIGRATION_LABEL_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.old_request_migration_label_with_current_shas.is_a_label_not_an_approval, true);
  assert.equal(out.old_request_migration_label_with_current_shas.approval_verb_present, false);
  assert.equal(out.old_request_migration_label_with_current_shas.is_a_separate_verbatim_approval, false);
  assert.equal(out.old_request_migration_label_with_current_shas.both_current_shas_verified, true);
  assert.equal(out.old_request_migration_label_with_current_shas.reviewed_text_sha, "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.old_request_migration_label_with_current_shas.rollback_plan_sha, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.old_request_migration_label_with_current_shas.differs_from_section_108,
    "A_MIGRATION_LABEL_WITH_TWO_CURRENT_SHAS_NOT_A_RATIFICATION_AND_DEPLOY_BUNDLE");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the session performs no migration and no reviewed src text appears", () => {
  const out = evaluate(OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_SHAS);
  assert.equal(out.old_request_migration_label_with_current_shas.no_migration_performed, true);
  assert.equal(out.old_request_migration_label_with_current_shas.migration_is_not_a_session_action, true);
  assert.equal(out.old_request_migration_label_with_current_shas.session_does_not_migrate_or_revalidate_a_refused_request, true);
  assert.equal(out.old_request_migration_label_with_current_shas.no_reviewed_text_for_src_changes, true);
  assert.equal(out.old_request_migration_label_with_current_shas.no_src_artifact_sha, true);
  assert.equal(out.old_request_migration_label_with_current_shas.src_modification_is_prohibited, true);
  assert.equal(out.old_request_migration_label_with_current_shas.deploy_is_prohibited, true);
  assert.equal(out.old_request_migration_label_with_current_shas.is_an_execution_approval, false);
  assert.equal(out.old_request_migration_label_with_current_shas.src_and_deploy_approvals, false);
  assert.equal(out.old_request_migration_label_with_current_shas.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["A_LABEL_NAMING_THE_REMEDY_IS_NOT_PERFORMING_THE_REMEDY",
    "SESSION_DOES_NOT_MIGRATE_OR_REVALIDATE_A_REFUSED_REQUEST",
    "SHAS_IDENTIFY_BUT_DO_NOT_AUTHORIZE_EXECUTION",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("a migration label opens no gate and changes no inventory state", () => {
  const out = evaluate(OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_SHAS);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_reenable_decision_solicited", "no_command_sent", "no_sql_delivered",
    "no_gate_opened", "no_inventory_change", "no_action_taken_on_production",
    "no_src_modified", "no_render_yaml_modified", "no_deploy", "no_sync",
    "no_true", "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.old_request_migration_label_with_current_shas as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.old_request_migration_label_with_current_shas.blockers_resolved, 0);
  assert.equal(out.old_request_migration_label_with_current_shas.gates_opened, 0);
  assert.equal(out.old_request_migration_label_with_current_shas.reenable_gate, "CLOSED");
  assert.equal(out.old_request_migration_label_with_current_shas.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("MIGRATION_LABEL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.ok(out.limitations.includes("NO_INVENTORY_CHANGE"));
  assert.equal(evaluate(RATIFICATION_OF_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY).old_request_migration_label_with_current_shas, null);
});


const REMAINING_STEPS_AND_DEPLOY_QUESTION = {
  ...structuredClone(OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_SHAS),
  remaining_steps_and_deploy_question: {
    operator_text: "نحن لا نتقدم هكذا انت تعطلني قل لي ما هو المتبقي و الخطوات لاستكمال المهمه و النشر",
    kind: "PROCEDURAL_QUESTION_ABOUT_REMAINING_WORK_AND_DEPLOY",
    received_in_chat: true,
    verdict: "PROCEDURAL_QUESTION_ANSWERED_WITH_REMAINING_STEPS_NO_GATE_OPENED",
    acknowledged_descriptively: true,
    differs_from_section_109: "A_PROCEDURAL_QUESTION_NOT_A_MIGRATION_LABEL",
    is_a_question: true,
    is_a_decision: false,
    is_an_approval: false,
    approval_verb_present: false,
    is_a_separate_verbatim_approval: false,
    references_pinned_sha: false,
    answer_scope: "DESCRIPTIVE_ONLY_REMAINING_BLOCKERS_AND_ORDERED_STEPS",
    remaining_blockers: 9,
    blockers_resolved: 0,
    gates_opened: 0,
    current_step_index: "6/11",
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    deploy_status: "PROHIBITED_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_phrase_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_inventory_change: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a procedural question about remaining work and deploy is not an approval", () => {
  const out = evaluate(REMAINING_STEPS_AND_DEPLOY_QUESTION);
  assert.equal(out.remaining_steps_and_deploy_question.kind,
    "PROCEDURAL_QUESTION_ABOUT_REMAINING_WORK_AND_DEPLOY");
  assert.equal(out.remaining_steps_and_deploy_question.verdict,
    "PROCEDURAL_QUESTION_ANSWERED_WITH_REMAINING_STEPS_NO_GATE_OPENED");
  assert.equal(out.remaining_steps_and_deploy_question.is_a_question, true);
  assert.equal(out.remaining_steps_and_deploy_question.is_a_decision, false);
  assert.equal(out.remaining_steps_and_deploy_question.is_an_approval, false);
  assert.equal(out.remaining_steps_and_deploy_question.approval_verb_present, false);
  assert.equal(out.remaining_steps_and_deploy_question.answer_scope,
    "DESCRIPTIVE_ONLY_REMAINING_BLOCKERS_AND_ORDERED_STEPS");
  assert.equal(out.remaining_steps_and_deploy_question.differs_from_section_109,
    "A_PROCEDURAL_QUESTION_NOT_A_MIGRATION_LABEL");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the remaining-steps answer keeps deploy prohibited and delivers no phrase", () => {
  const out = evaluate(REMAINING_STEPS_AND_DEPLOY_QUESTION);
  assert.equal(out.remaining_steps_and_deploy_question.remaining_blockers, 9);
  assert.equal(out.remaining_steps_and_deploy_question.blockers_resolved, 0);
  assert.equal(out.remaining_steps_and_deploy_question.gates_opened, 0);
  assert.equal(out.remaining_steps_and_deploy_question.current_step_index, "6/11");
  assert.equal(out.remaining_steps_and_deploy_question.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  assert.equal(out.remaining_steps_and_deploy_question.deploy_status,
    "PROHIBITED_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT");
  assert.equal(out.remaining_steps_and_deploy_question.no_phrase_delivered, true);
  assert.equal(out.remaining_steps_and_deploy_question.no_approval_phrase_solicited, true);
  assert.equal(out.remaining_steps_and_deploy_question.no_template_delivered, true);
  assert.equal(out.remaining_steps_and_deploy_question.no_reenable_decision_solicited, true);
  for (const w of ["PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL",
    "REMAINING_STEPS_LISTED_IN_CHAT_NO_GATE_OPENED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the remaining-steps answer opens no gate and changes no inventory state", () => {
  const out = evaluate(REMAINING_STEPS_AND_DEPLOY_QUESTION);
  for (const k of ["no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_inventory_change", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.remaining_steps_and_deploy_question as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.remaining_steps_and_deploy_question.reenable_gate, "CLOSED");
  assert.equal(out.remaining_steps_and_deploy_question.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("REMAINING_STEPS_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_SHAS).remaining_steps_and_deploy_question, null);
});


const ADVANCE_TO_NEXT_STEP_REQUEST = {
  ...structuredClone(REMAINING_STEPS_AND_DEPLOY_QUESTION),
  advance_to_next_step_request: {
    operator_text: "ممكن ان ننتقل الي الخطوه التاليه",
    kind: "REQUEST_TO_ADVANCE_TO_THE_NEXT_STEP",
    received_in_chat: true,
    verdict: "ADVANCE_TO_NEXT_STEP_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    differs_from_section_110: "AN_ADVANCE_REQUEST_NOT_A_PROCEDURAL_QUESTION_ABOUT_REMAINING_STEPS",
    is_a_question: true,
    is_a_request_to_advance: true,
    is_a_decision: false,
    is_an_approval: false,
    approval_verb_present: false,
    is_a_separate_verbatim_approval: false,
    references_pinned_sha: false,
    no_pinned_sha_in_message: true,
    session_cannot_advance_or_open_a_step: true,
    no_reviewed_text_for_src_changes: true,
    no_acceptance_criteria_for_src_changes: true,
    no_src_artifact_sha: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    no_blanket_approval: true,
    current_step_index: "6/11",
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_phrase_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_inventory_change: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a request to advance to the next step is refused", () => {
  const out = evaluate(ADVANCE_TO_NEXT_STEP_REQUEST);
  assert.equal(out.advance_to_next_step_request.kind,
    "REQUEST_TO_ADVANCE_TO_THE_NEXT_STEP");
  assert.equal(out.advance_to_next_step_request.verdict,
    "ADVANCE_TO_NEXT_STEP_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.advance_to_next_step_request.is_a_request_to_advance, true);
  assert.equal(out.advance_to_next_step_request.is_a_decision, false);
  assert.equal(out.advance_to_next_step_request.is_an_approval, false);
  assert.equal(out.advance_to_next_step_request.approval_verb_present, false);
  assert.equal(out.advance_to_next_step_request.is_a_separate_verbatim_approval, false);
  assert.equal(out.advance_to_next_step_request.differs_from_section_110,
    "AN_ADVANCE_REQUEST_NOT_A_PROCEDURAL_QUESTION_ABOUT_REMAINING_STEPS");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the session cannot advance and no reviewed src text exists", () => {
  const out = evaluate(ADVANCE_TO_NEXT_STEP_REQUEST);
  assert.equal(out.advance_to_next_step_request.session_cannot_advance_or_open_a_step, true);
  assert.equal(out.advance_to_next_step_request.no_pinned_sha_in_message, true);
  assert.equal(out.advance_to_next_step_request.no_reviewed_text_for_src_changes, true);
  assert.equal(out.advance_to_next_step_request.no_src_artifact_sha, true);
  assert.equal(out.advance_to_next_step_request.src_modification_is_prohibited, true);
  assert.equal(out.advance_to_next_step_request.deploy_is_prohibited, true);
  assert.equal(out.advance_to_next_step_request.current_step_index, "6/11");
  assert.equal(out.advance_to_next_step_request.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  assert.equal(out.advance_to_next_step_request.no_phrase_delivered, true);
  assert.equal(out.advance_to_next_step_request.no_approval_phrase_solicited, true);
  assert.equal(out.advance_to_next_step_request.no_template_delivered, true);
  assert.equal(out.advance_to_next_step_request.no_reenable_decision_solicited, true);
  for (const w of ["SESSION_CANNOT_ADVANCE_OR_OPEN_A_STEP_OR_GATE",
    "AN_INTENT_TO_PROCEED_IS_NOT_A_SEPARATE_VERBATIM_APPROVAL",
    "NO_PINNED_SHA_IN_MESSAGE",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("an advance request opens no gate and changes no inventory state", () => {
  const out = evaluate(ADVANCE_TO_NEXT_STEP_REQUEST);
  for (const k of ["no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_inventory_change", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.advance_to_next_step_request as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.advance_to_next_step_request.blockers_resolved, 0);
  assert.equal(out.advance_to_next_step_request.gates_opened, 0);
  assert.equal(out.advance_to_next_step_request.reenable_gate, "CLOSED");
  assert.equal(out.advance_to_next_step_request.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("ADVANCE_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(REMAINING_STEPS_AND_DEPLOY_QUESTION).advance_to_next_step_request, null);
});


const SRC_REVIEWED_TEXT_TOPIC_LABEL = {
  ...structuredClone(ADVANCE_TO_NEXT_STEP_REQUEST),
  src_reviewed_text_topic_label: {
    operator_text: "نص مُراجَع لتغييرات `src`",
    kind: "BARE_NOUN_PHRASE_NAMING_A_SRC_REVIEWED_TEXT",
    received_in_chat: true,
    verdict: "SRC_REVIEWED_TEXT_TOPIC_NAMED_STRICT_REJECT_NOT_ACTIONABLE",
    acknowledged_descriptively: true,
    differs_from_section_111: "A_NOUN_PHRASE_NAMING_THE_MISSING_ARTIFACT_NOT_AN_ADVANCE_REQUEST",
    is_a_bare_noun_phrase: true,
    is_an_explicit_verbatim_approval: false,
    is_a_separate_commission: false,
    is_a_decision: false,
    is_an_approval: false,
    approval_verb_present: false,
    references_pinned_sha: false,
    no_pinned_sha_in_message: true,
    no_text_body_provided: true,
    no_acceptance_criteria: true,
    no_reviewed_text_for_src_changes: true,
    no_src_artifact_sha: true,
    session_does_not_author_reviewed_src_text: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    no_blanket_approval: true,
    current_step_index: "6/11",
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_phrase_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_inventory_change: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a bare noun phrase naming a src reviewed text is refused", () => {
  const out = evaluate(SRC_REVIEWED_TEXT_TOPIC_LABEL);
  assert.equal(out.src_reviewed_text_topic_label.kind,
    "BARE_NOUN_PHRASE_NAMING_A_SRC_REVIEWED_TEXT");
  assert.equal(out.src_reviewed_text_topic_label.verdict,
    "SRC_REVIEWED_TEXT_TOPIC_NAMED_STRICT_REJECT_NOT_ACTIONABLE");
  assert.equal(out.src_reviewed_text_topic_label.is_a_bare_noun_phrase, true);
  assert.equal(out.src_reviewed_text_topic_label.is_an_explicit_verbatim_approval, false);
  assert.equal(out.src_reviewed_text_topic_label.is_a_separate_commission, false);
  assert.equal(out.src_reviewed_text_topic_label.is_a_decision, false);
  assert.equal(out.src_reviewed_text_topic_label.is_an_approval, false);
  assert.equal(out.src_reviewed_text_topic_label.approval_verb_present, false);
  assert.equal(out.src_reviewed_text_topic_label.differs_from_section_111,
    "A_NOUN_PHRASE_NAMING_THE_MISSING_ARTIFACT_NOT_AN_ADVANCE_REQUEST");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("naming the artifact prepares no body SHA or criteria", () => {
  const out = evaluate(SRC_REVIEWED_TEXT_TOPIC_LABEL);
  assert.equal(out.src_reviewed_text_topic_label.no_pinned_sha_in_message, true);
  assert.equal(out.src_reviewed_text_topic_label.no_text_body_provided, true);
  assert.equal(out.src_reviewed_text_topic_label.no_acceptance_criteria, true);
  assert.equal(out.src_reviewed_text_topic_label.no_reviewed_text_for_src_changes, true);
  assert.equal(out.src_reviewed_text_topic_label.no_src_artifact_sha, true);
  assert.equal(out.src_reviewed_text_topic_label.session_does_not_author_reviewed_src_text, true);
  assert.equal(out.src_reviewed_text_topic_label.src_modification_is_prohibited, true);
  assert.equal(out.src_reviewed_text_topic_label.deploy_is_prohibited, true);
  assert.equal(out.src_reviewed_text_topic_label.current_step_index, "6/11");
  assert.equal(out.src_reviewed_text_topic_label.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  assert.equal(out.src_reviewed_text_topic_label.no_phrase_delivered, true);
  assert.equal(out.src_reviewed_text_topic_label.no_approval_phrase_solicited, true);
  assert.equal(out.src_reviewed_text_topic_label.no_template_delivered, true);
  assert.equal(out.src_reviewed_text_topic_label.no_reenable_decision_solicited, true);
  for (const w of ["A_NOUN_PHRASE_NAMING_AN_ARTIFACT_IS_NOT_PREPARING_IT",
    "NO_TEXT_BODY_NO_PINNED_SHA_NO_ACCEPTANCE_CRITERIA",
    "SESSION_DOES_NOT_AUTHOR_REVIEWED_SRC_TEXT",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the src topic label opens no gate and changes no inventory state", () => {
  const out = evaluate(SRC_REVIEWED_TEXT_TOPIC_LABEL);
  for (const k of ["no_command_sent", "no_sql_delivered", "no_gate_opened",
    "no_inventory_change", "no_action_taken_on_production", "no_src_modified",
    "no_render_yaml_modified", "no_deploy", "no_sync", "no_true",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.src_reviewed_text_topic_label as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.src_reviewed_text_topic_label.blockers_resolved, 0);
  assert.equal(out.src_reviewed_text_topic_label.gates_opened, 0);
  assert.equal(out.src_reviewed_text_topic_label.reenable_gate, "CLOSED");
  assert.equal(out.src_reviewed_text_topic_label.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("SRC_REVIEWED_TEXT_TOPIC_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(ADVANCE_TO_NEXT_STEP_REQUEST).src_reviewed_text_topic_label, null);
});


const MERGE_PULL_REQUEST_REQUEST = {
  ...structuredClone(SRC_REVIEWED_TEXT_TOPIC_LABEL),
  merge_pull_request_request: {
    operator_text: "Please merge the pull request.",
    kind: "DIRECT_MERGE_REQUEST_AGAINST_A_NOT_READY_BRANCH",
    received_in_chat: true,
    verdict: "MERGE_REQUEST_REFUSED_NOT_READY_NO_DEPLOY",
    acknowledged_descriptively: true,
    differs_from_section_113: "A_MERGE_REQUEST_NOT_A_REQUEST_TO_OPEN_A_PR",
    is_an_execution_request: true,
    is_a_separate_verbatim_approval: false,
    is_a_decision: false,
    is_an_approval: false,
    approval_verb_present: false,
    references_pinned_sha: false,
    no_pinned_sha_in_message: true,
    pr_number: 95,
    pr_state: "OPEN",
    no_merge_performed: true,
    no_close_performed: true,
    pr_base: "main",
    merge_would_change_production_src: true,
    merge_would_trigger_a_deploy: true,
    deploy_from_main_documented_in_section: 51,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    sync_is_prohibited: true,
    no_true: true,
    no_reenable_decision: true,
    no_blanket_approval: true,
    current_step_index: "6/11",
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_phrase_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_inventory_change: true,
    no_action_taken_on_production: true,
    no_render_yaml_modified: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a direct merge request against a not-ready branch is refused", () => {
  const out = evaluate(MERGE_PULL_REQUEST_REQUEST);
  assert.equal(out.merge_pull_request_request.kind,
    "DIRECT_MERGE_REQUEST_AGAINST_A_NOT_READY_BRANCH");
  assert.equal(out.merge_pull_request_request.verdict,
    "MERGE_REQUEST_REFUSED_NOT_READY_NO_DEPLOY");
  assert.equal(out.merge_pull_request_request.is_an_execution_request, true);
  assert.equal(out.merge_pull_request_request.is_a_separate_verbatim_approval, false);
  assert.equal(out.merge_pull_request_request.is_a_decision, false);
  assert.equal(out.merge_pull_request_request.is_an_approval, false);
  assert.equal(out.merge_pull_request_request.approval_verb_present, false);
  assert.equal(out.merge_pull_request_request.differs_from_section_113,
    "A_MERGE_REQUEST_NOT_A_REQUEST_TO_OPEN_A_PR");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("merging would deploy and change production src so it stays prohibited", () => {
  const out = evaluate(MERGE_PULL_REQUEST_REQUEST);
  assert.equal(out.merge_pull_request_request.pr_number, 95);
  assert.equal(out.merge_pull_request_request.pr_state, "OPEN");
  assert.equal(out.merge_pull_request_request.no_merge_performed, true);
  assert.equal(out.merge_pull_request_request.no_close_performed, true);
  assert.equal(out.merge_pull_request_request.pr_base, "main");
  assert.equal(out.merge_pull_request_request.merge_would_change_production_src, true);
  assert.equal(out.merge_pull_request_request.merge_would_trigger_a_deploy, true);
  assert.equal(out.merge_pull_request_request.deploy_from_main_documented_in_section, 51);
  assert.equal(out.merge_pull_request_request.src_modification_is_prohibited, true);
  assert.equal(out.merge_pull_request_request.deploy_is_prohibited, true);
  assert.equal(out.merge_pull_request_request.sync_is_prohibited, true);
  assert.equal(out.merge_pull_request_request.no_true, true);
  assert.equal(out.merge_pull_request_request.no_reenable_decision, true);
  assert.equal(out.merge_pull_request_request.current_step_index, "6/11");
  assert.equal(out.merge_pull_request_request.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["MERGE_TO_MAIN_WOULD_DEPLOY_AND_CHANGE_PRODUCTION_SRC",
    "AN_EXECUTION_REQUEST_IS_NOT_A_SEPARATE_VERBATIM_APPROVAL",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the merge request opens no gate, delivers no phrase and changes no state", () => {
  const out = evaluate(MERGE_PULL_REQUEST_REQUEST);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_phrase_delivered", "no_reenable_decision_solicited", "no_command_sent",
    "no_sql_delivered", "no_gate_opened", "no_inventory_change",
    "no_action_taken_on_production", "no_render_yaml_modified",
    "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.merge_pull_request_request as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.merge_pull_request_request.blockers_resolved, 0);
  assert.equal(out.merge_pull_request_request.gates_opened, 0);
  assert.equal(out.merge_pull_request_request.reenable_gate, "CLOSED");
  assert.equal(out.merge_pull_request_request.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("MERGE_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.ok(out.limitations.includes("PULL_REQUEST_STAYS_OPEN_NOT_MERGED"));
  assert.equal(evaluate(SRC_REVIEWED_TEXT_TOPIC_LABEL).merge_pull_request_request, null);
});


const NEXT_STEP_APPROVAL_SHA_QUESTION = {
  ...structuredClone(MERGE_PULL_REQUEST_REQUEST),
  next_step_approval_sha_question: {
    operator_text: "اين بصمه الموافقه للخطوه القادمه",
    kind: "PROCEDURAL_QUESTION_ABOUT_A_NEXT_STEP_APPROVAL_SHA",
    received_in_chat: true,
    verdict: "NEXT_STEP_APPROVAL_SHA_QUESTION_ANSWERED_DESCRIPTIVELY_NO_SHA_DELIVERED",
    acknowledged_descriptively: true,
    differs_from_section_114: "A_SHA_QUESTION_NOT_A_MERGE_REQUEST",
    is_a_question: true,
    is_an_approval: false,
    is_a_decision: false,
    approval_verb_present: false,
    is_a_separate_verbatim_approval: false,
    references_pinned_sha: false,
    no_pinned_sha_in_message: true,
    answer_scope: "DESCRIPTIVE_ONLY_WHICH_SHAS_EXIST_AND_WHY_NO_APPROVAL_SHA_EXISTS",
    known_shas_verified: true,
    reviewed_text_sha: "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e",
    rollback_plan_sha: "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c",
    old_probe_sha: "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb",
    no_next_step_approval_sha_exists: true,
    no_sha_delivered: true,
    no_reviewed_text_for_src_changes: true,
    no_acceptance_criteria_for_src_changes: true,
    no_src_artifact_sha: true,
    session_does_not_author_reviewed_src_text: true,
    src_modification_is_prohibited: true,
    deploy_is_prohibited: true,
    no_blanket_approval: true,
    current_step_index: "6/11",
    next_descriptive_step: "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED",
    strict_reject_phrase: "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.",
    no_approval_phrase_solicited: true,
    no_template_delivered: true,
    no_phrase_delivered: true,
    no_reenable_decision_solicited: true,
    no_command_sent: true,
    no_sql_delivered: true,
    no_gate_opened: true,
    no_inventory_change: true,
    no_action_taken_on_production: true,
    no_src_modified: true,
    no_render_yaml_modified: true,
    no_deploy: true,
    no_sync: true,
    no_true: true,
    no_secrets_in_chat: true,
    no_file_reference: true,
    blockers_resolved: 0,
    gates_opened: 0,
    next_gate: "SEPARATE_REENABLE_DECISION",
    reenable_gate: "CLOSED",
    overall: "NOT_READY",
  },
};

test("a question about the next-step approval SHA delivers no SHA", () => {
  const out = evaluate(NEXT_STEP_APPROVAL_SHA_QUESTION);
  assert.equal(out.next_step_approval_sha_question.kind,
    "PROCEDURAL_QUESTION_ABOUT_A_NEXT_STEP_APPROVAL_SHA");
  assert.equal(out.next_step_approval_sha_question.verdict,
    "NEXT_STEP_APPROVAL_SHA_QUESTION_ANSWERED_DESCRIPTIVELY_NO_SHA_DELIVERED");
  assert.equal(out.next_step_approval_sha_question.is_a_question, true);
  assert.equal(out.next_step_approval_sha_question.is_an_approval, false);
  assert.equal(out.next_step_approval_sha_question.approval_verb_present, false);
  assert.equal(out.next_step_approval_sha_question.no_pinned_sha_in_message, true);
  assert.equal(out.next_step_approval_sha_question.no_next_step_approval_sha_exists, true);
  assert.equal(out.next_step_approval_sha_question.no_sha_delivered, true);
  assert.equal(out.next_step_approval_sha_question.differs_from_section_114,
    "A_SHA_QUESTION_NOT_A_MERGE_REQUEST");
  assert.equal(out.overall_release_status, "NOT_READY");
});

test("the three known SHAs identify artifacts not an approval", () => {
  const out = evaluate(NEXT_STEP_APPROVAL_SHA_QUESTION);
  assert.equal(out.next_step_approval_sha_question.known_shas_verified, true);
  assert.equal(out.next_step_approval_sha_question.reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(out.next_step_approval_sha_question.rollback_plan_sha,
    "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(out.next_step_approval_sha_question.old_probe_sha,
    "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb");
  assert.equal(out.next_step_approval_sha_question.no_reviewed_text_for_src_changes, true);
  assert.equal(out.next_step_approval_sha_question.no_acceptance_criteria_for_src_changes, true);
  assert.equal(out.next_step_approval_sha_question.no_src_artifact_sha, true);
  assert.equal(out.next_step_approval_sha_question.session_does_not_author_reviewed_src_text, true);
  assert.equal(out.next_step_approval_sha_question.src_modification_is_prohibited, true);
  assert.equal(out.next_step_approval_sha_question.deploy_is_prohibited, true);
  assert.equal(out.next_step_approval_sha_question.current_step_index, "6/11");
  assert.equal(out.next_step_approval_sha_question.next_descriptive_step,
    "SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED");
  for (const w of ["NO_NEXT_STEP_APPROVAL_SHA_EXISTS",
    "SHAS_IDENTIFY_BUT_DO_NOT_AUTHORIZE_EXECUTION",
    "A_SHA_IS_PINNED_TO_A_REVIEWED_TEXT_NOT_TO_AN_APPROVAL",
    "NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS",
    "APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES",
    "SESSION_DOES_NOT_AUTHOR_REVIEWED_SRC_TEXT",
    "NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE",
    "SRC_MODIFICATION_IS_PROHIBITED",
    "DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED",
    "A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION",
    "SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS",
    "STRICT_REJECT_POLICY_STILL_IN_FORCE"])
    assert.ok(out.warnings.includes(w), w);
});

test("the SHA question delivers no phrase and opens no gate", () => {
  const out = evaluate(NEXT_STEP_APPROVAL_SHA_QUESTION);
  for (const k of ["no_approval_phrase_solicited", "no_template_delivered",
    "no_phrase_delivered", "no_reenable_decision_solicited", "no_command_sent",
    "no_sql_delivered", "no_gate_opened", "no_inventory_change",
    "no_action_taken_on_production", "no_src_modified", "no_render_yaml_modified",
    "no_deploy", "no_sync", "no_true", "no_secrets_in_chat", "no_file_reference"])
    assert.equal((out.next_step_approval_sha_question as unknown as Record<string, boolean>)[k], true, k);
  assert.equal(out.next_step_approval_sha_question.blockers_resolved, 0);
  assert.equal(out.next_step_approval_sha_question.gates_opened, 0);
  assert.equal(out.next_step_approval_sha_question.reenable_gate, "CLOSED");
  assert.equal(out.next_step_approval_sha_question.finance_enabled, false);
  assert.equal(out.next_gate, "SEPARATE_REENABLE_DECISION");
  assert.ok(out.limitations.includes("SHA_QUESTION_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE"));
  assert.equal(evaluate(MERGE_PULL_REQUEST_REQUEST).next_step_approval_sha_question, null);
});
