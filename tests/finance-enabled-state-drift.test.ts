/**
 * TEST ONLY — configuration/documentation drift guard. No database connection,
 * no production read, no secrets. It pins the CONFIRMED 2026-11-05 sequence:
 *
 *   1. FINANCE_ENABLED was true on Render (operator-confirmed) while the
 *      documented preconditions for opening the finance UI were unmet.
 *   2. The operator then turned it OFF to false from the Render Environment tab.
 *   3. render.yaml still declares "true" (blueprint/live divergence), so a
 *      Blueprint Sync could silently re-enable finance.
 *   4. The identity gap and NOT_READY verdict are unchanged by the flag.
 *
 * If someone re-enables the flag, syncs the blueprint, edits the gate, or drops
 * the analysis without reconciling all of these, this test fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("render.yaml still declares true — this is now a blueprint/live divergence, not the live value", () => {
  const yaml = read("render.yaml");
  const block = yaml.match(/- key: FINANCE_ENABLED\s*\n\s*value:\s*"([^"]+)"/);
  assert(block, "FINANCE_ENABLED declaration exists in render.yaml");
  assert.equal(block[1], "true", "blueprint still says true; do not lose this divergence");
  assert.doesNotMatch(
    yaml.slice(yaml.indexOf("- key: FINANCE_ENABLED"), yaml.indexOf("- key: FINANCE_ENABLED") + 160),
    /sync:\s*false/,
    "FINANCE_ENABLED is blueprint-managed, so a Sync can overwrite the dashboard value",
  );
});

test("the code gate and the finance page redirect are still driven by that flag", () => {
  assert.match(read("src/lib/finance/db.ts"), /process\.env\.FINANCE_ENABLED === "true"/);
  assert.match(read("src/app/(app)/finance/page.tsx"), /if \(!financeEnabled\(\)\) redirect\("\/dashboard"\)/);
  assert.match(read("src/lib/commerce-operations.ts"), /if \(process\.env\.FINANCE_ENABLED !== "true"\) return;/);
  // Turning it off rejects new cash refunds instead of silently posting untracked cash.
  assert.match(read("src/lib/commerce-operations.ts"), /الرد النقدي متوقف للمراجعة عند تعطيل المالية/);
  // The directory custody protection must survive the flag being off.
  assert.match(read("src/lib/admin-directory-operations.ts"), /Detect an installed finance schema even when its UI flag is off/);
});

test("the operator's false state and the blueprint divergence are both recorded", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /FINANCE_ENABLED=false|المشغّل أطفأ المفتاح/);
  assert.match(result, /render\.yaml:31.*ما زال|ما زال.*render\.yaml:31/);
  assert.match(result, /لا تضغط `Sync`/);
  assert.match(result, /تأكيد من المشغّل/);
  assert.match(result, /لم تُغيّر الجلسة المتغير/);
  assert.match(result, /IDENTITY_GAP_CONFIRMED/);
  assert.match(result, /NOT_READY/);
  assert.match(result, /bypass_rls/);
  assert.match(result, /المالية ما زالت غير جاهزة للنشر/);

  const readiness = read("docs/finance-release-readiness.md");
  assert.match(readiness, /FINANCE_ENABLED=false/);
  assert.match(readiness, /ما زالت غير جاهزة للنشر/);
});

test("the runbook, access and atomic docs all point at the updated state", () => {
  assert.match(read("docs/finance-release-runbook.md"), /المشغّل أطفأ المفتاح/);
  const access = read("docs/finance-app-connection-access-ar.md");
  assert.match(access, /القيمة الفعلية `false`/);
  assert.match(access, /Sync/);
  const atomic = read("docs/finance-atomic-cash-contract-ar.md");
  assert.match(atomic, /أطفأه المشغّل إلى `false`/);
  assert.match(atomic, /لا يُقرأ `false` كإغلاق للفجوة/);
  assert.match(read("docs/finance-release-log.md"), /## ٢٥\./);
});

test("the deploy-log evidence is recorded with its limits", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /751d4e55728201a7ce6c5d720a728bf4393ec326/);
  assert.match(result, /Your service is live/);
  assert.match(result, /بلا سنة/);
  assert.match(result, /سجل النشر وحده لا يُثبت/);
  assert.match(result, /\/setup/);
  assert.match(result, /مبنية داخل الحزمة/);
  assert.match(read("docs/finance-release-log.md"), /## ٢٦\./);
  // The deployed commit itself still declares true in render.yaml.
  assert.match(read("render.yaml"), /- key: FINANCE_ENABLED\s*\n\s*value:\s*"true"/);
});

test("the /setup runtime evidence is recorded with its limits", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /التحقق الحاسم أُنجز/);
  assert.match(result, /معطّلة مرحليًا/);
  assert.match(result, /وحدة المالية متوقفة اختياريًا عبر FINANCE_ENABLED/);
  assert.match(result, /finance-schema/);
  assert.match(result, /أول دليل مباشر من العملية الشغّالة/);
  assert.match(result, /ليست `"true"`/);
  assert.match(result, /لم تقرأ `finance\.accounts`/);
  assert.match(result, /لا يُغني عن \*\*الصلة الثانية/);
  assert.match(read("docs/finance-release-readiness.md"), /أُنجز تحقّق `\/setup`/);
  assert.match(read("docs/finance-release-log.md"), /## ٢٧\./);
  assert.match(result, /ما زالت غير جاهزة للنشر|NOT_READY/);
});

test("the production-SQL offer is logged as declined, with no upgrade authorized", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٢٨\./);
  assert.match(log, /لم تُجَز أي SQL كتابة/);
  assert.match(log, /المخطط موجود بالفعل/);
  assert.match(log, /لا تُنفَّذ أي SQL الآن/);
  assert.match(log, /دور SQL Editor قد يختلف عن دور التطبيق/);
  const readiness = read("docs/finance-release-readiness.md");
  assert.match(readiness, /لم يُقبل العرض/);
  assert.match(readiness, /ما زالت غير جاهزة للنشر/);
  // No executable SQL was added to the workspace by this turn.
  assert.equal(read("prisma/manual-finance-grants.sql").includes("لا يُشغَّل إلا بموافقة منفصلة"), true);
});

test("the executable step checklist and the non-runnable role draft exist with their gates", () => {
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /لا تُنفَّذ أي SQL الآن|لا تُنفّذ أي SQL الآن/);
  assert.match(steps, /BEGIN TRANSACTION READ ONLY/);
  assert.match(steps, /ROLLBACK;/);
  assert.match(steps, /غير مُجاز للتنفيذ/);
  assert.match(steps, /app_connection_probe/);
  assert.match(steps, /DATABASE_URL/);
  const draft = read("prototypes/finance-app-identity/role-change-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /غير قابل للتنفيذ/);
  assert.match(draft, /<FINANCE_APP_ROLE>/);
  assert.match(draft, /خطة الرجوع/);
  assert.doesNotMatch(draft, /CREATE ROLE[\s\S]{0,40}LOGIN PASSWORD/, "no runnable credential-bearing SQL in the draft");
  assert.match(read("docs/finance-release-log.md"), /## ٢٩\./);
  assert.match(read("docs/finance-release-readiness.md"), /finance-identity-remediation-steps-ar\.md/);
});

test("the Android signing fingerprint is a separate thing from the SQL probe pin", () => {
  const route = read("src/app/.well-known/assetlinks.json/route.ts");
  assert.match(route, /process\.env\.ANDROID_SHA256/);
  assert.match(route, /sha256_cert_fingerprints/);
  assert.doesNotMatch(route, /d960c559/, "the Android fingerprint must never be confused with the reviewed SQL digest");
  const standalone = read("prototypes/finance-app-identity/app-identity-probe-standalone.mjs");
  assert.match(standalone, /REVIEWED_SHA256 = "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb"/);
  assert.doesNotMatch(standalone, /FB:19:94:73/);
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٣١\./);
  assert.match(log, /لا يُطلب منك أي إجراء بها الآن/);
});

test("the second connection closes C3 without closing readiness", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /## ١٠\./);
  assert.match(result, /C3_stable_identity     = PASS/);
  assert.match(result, /whole_aggregate_identical=true/);
  assert.match(result, /C1 وC2 ما زالا `FAIL`/);
  assert.match(result, /ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP/);
  assert.match(result, /لا يُقرأ `PASS` كدليل سلامة/);
  assert.match(result, /NOT_READY/);
  const readiness = read("docs/finance-release-readiness.md");
  assert.match(readiness, /C3` \(`PASS`\)/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /المرحلة ١ — إغلاق `C3` \(\*\*أُنجزت\*\*/);
  assert.match(steps, /المرحلة ١ — إغلاق `C3`/);
  assert.match(read("docs/finance-release-log.md"), /## ٣٢\./);
  const evaluator = read("prototypes/finance-app-identity/evaluate-app-connection-probe.mjs");
  assert.match(evaluator, /--compare/);
  assert.match(evaluator, /overall_release_status: "NOT_READY"/);
});

test("the single reference names the next step as phase 2 with its approval gate", () => {
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /## ٠\. الحالة الآن والخطوة التالية/);
  assert.match(steps, /المرحلة ٤ — أُنجزت \(بتقرير المشغّل\)/);
  assert.match(steps, /بوابة النشر فُتحت \(بيئة فقط\)/);
  assert.match(steps, /الخطوة التالية = مراجعة التحليل الأوفلاين §٧٠/);
  assert.match(steps, /OPEN_ENV_VAR_ONLY/);
  assert.match(steps, /راجعتُ نص الجرد وأُجيز تشغيله قراءةً فقط/);
  assert.match(steps, /C3=PASS/);
  assert.match(steps, /لا تضغط `Sync`/);
  assert.match(read("docs/finance-release-log.md"), /## ٣٣\./);
});

test("the preflight inventory stops on the 80-vs-18 count and makes a separate role mandatory", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /## ١١\./);
  assert.match(result, /STOP_TRIGGERED_COUNT_DEFINITION_EXPLAINED|شرط الإيقاف مُفعّل/);
  assert.match(result, /80 = 18 \+ 15 \+ 47/);
  assert.match(result, /has_admin_option=false/);
  assert.match(result, /دور تطبيق منفصل صار شرطًا إلزاميًا/);
  assert.match(result, /public_relation_count=63/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /قُبلت تسوية الـ80 كائنًا|قُبلت التسوية/);
  const draft = read("prototypes/finance-app-identity/role-change-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /## أ\. أرقام الجرد الفعلية/);
  assert.doesNotMatch(draft, /CREATE ROLE[\s\S]{0,80}LOGIN PASSWORD/i, "still not pasteable SQL");
  assert.match(read("docs/finance-release-log.md"), /## ٣٥\./);
  const evaluator = read("prototypes/finance-app-identity/evaluate-preflight-inventory.mjs");
  assert.match(evaluator, /STOP_TRIGGERED_COUNT_DEFINITION_EXPLAINED/);
});

test("readiness is explicitly NOT_READY in the docs and both evaluators", () => {
  assert.match(read("docs/finance-release-readiness.md"), /ما زالت غير جاهزة للنشر|غير جاهزة للنشر/);
  assert.match(read("docs/finance-app-connection-probe-result-ar.md"), /IDENTITY_GAP_CONFIRMED/);
  const evalApp = read("prototypes/finance-app-identity/evaluate-app-connection-probe.mjs");
  assert.match(evalApp, /overall_release_status: "NOT_READY"/);
  const evalInv = read("prototypes/finance-app-identity/evaluate-preflight-inventory.mjs");
  assert.match(evalInv, /overall_release_status: "NOT_READY"/);
  assert.match(evalInv, /STOP_TRIGGERED_COUNT_DEFINITION_EXPLAINED/);
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٣٦\./);
  assert.match(log, /لا تُضغط `Sync`/);
  assert.match(log, /موافقة نشر منفصلة/);
});

test("the operator's acceptance closes STOP only and leaves the SQL gate shut", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /## ١٢\./);
  assert.match(result, /نعم اقبل اكمل الخطوات سريعا/);
  assert.match(result, /ليس موافقة SQL تنفيذية/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /المرحلة ٢ — الجرد المسبق \(\*\*أُنجزت/);
  assert.match(steps, /STOP مُلغى بقرار صريح/);
  assert.match(steps, /المرحلة ٣ — مسودة تغيير الأدوار \(\*\*أُنجزت مخبريًا/);
  const draft = read("prototypes/finance-app-identity/role-change-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /## ٣أ\. متطلبات تقنية مكتشفة/);
  assert.match(draft, /Create role|CREATE ROLE|المسار المعتمد/, "role-creation path is now decided");
  assert.match(draft, /63 كائنًا/);
  assert.match(draft, /لا `REASSIGN OWNED` شامل/);
  assert.doesNotMatch(draft, /CREATE ROLE[\s\S]{0,80}LOGIN PASSWORD/i, "still no pasteable SQL");
  assert.match(read("docs/finance-release-log.md"), /## ٣٧\./);
});

test("the supplementary public inventory defines the grant scope but opens no SQL gate", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /## ١٣\./);
  assert.match(result, /PUBLIC_INVENTORY_CONFIRMED_GRANT_SCOPE_KNOWN/);
  assert.match(result, /63 = 33/);
  assert.match(result, /مُؤهَّلًا باسم المخطط/);
  assert.match(result, /غير متحقق/);
  const draft = read("prototypes/finance-app-identity/role-change-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /## ب\. الجرد التكميلي/);
  assert.match(draft, /USAGE.*public.*finance|`USAGE` على `public` و`finance`/);
  assert.match(draft, /موافقة SQL صريحة منفصلة/);
  assert.doesNotMatch(draft, /CREATE ROLE[\s\S]{0,80}LOGIN PASSWORD/i, "still no pasteable SQL");
  assert.match(read("docs/finance-release-log.md"), /## ٣٩\./);
  const evaluator = read("prototypes/finance-app-identity/evaluate-public-inventory.mjs");
  assert.match(evaluator, /overall_release_status: "NOT_READY"/);
  assert.match(evaluator, /DOES_NOT_AUTHORIZE_ROLE_CREATION_OR_OWNERSHIP_TRANSFER/);
});

test("Console-created Neon roles are rejected and the final text stays unexecuted", () => {
  const result = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(result, /## ١٤\./);
  assert.match(result, /Neon Console/);
  assert.match(result, /neon_superuser/);
  assert.match(result, /تُصحَّح هنا صراحةً|خاطئة/);
  assert.match(result, /selahtone_app/);
  const final = read("prototypes/finance-app-identity/phase4-sql-FINAL-FOR-REVIEW-NOT-EXECUTED.md");
  assert.match(final, /NOT EXECUTED/);
  assert.match(final, /<GENERATED_LOCALLY>/);
  assert.match(final, /^ROLLBACK;/m);
  assert.doesNotMatch(final.split("```sql\n")[1].split("\n```")[0], /^\s*COMMIT;/m);
  assert.match(final, /موافقة SQL صريحة منفصلة/);
  assert.match(read("docs/finance-release-log.md"), /## ٤١\./);
});

test("the final review SQL is a separate file, never folded into the non-runnable draft", () => {
  const draft = read("prototypes/finance-app-identity/role-change-DRAFT-NOT-EXECUTABLE.md");
  assert.doesNotMatch(draft, /LOGIN PASSWORD/i);
  const final = read("prototypes/finance-app-identity/phase4-sql-FINAL-FOR-REVIEW-NOT-EXECUTED.md");
  assert.match(final, /NOT EXECUTED/);
  assert.match(final, /<GENERATED_LOCALLY>/);
  assert.match(final, /ROLLBACK;/);
  assert.doesNotMatch(final.split("```sql\n")[1].split("\n```")[0], /^\s*COMMIT;/m);
});

test("the SQL was pasted into chat for review only, with no execution approval", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٢\./);
  assert.match(log, /لم تصل عبارة الموافقة/);
  assert.match(log, /نسخة المراجعة/);
  const final = read("prototypes/finance-app-identity/phase4-sql-FINAL-FOR-REVIEW-NOT-EXECUTED.md");
  assert.match(final, /^ROLLBACK;/m);
  assert.doesNotMatch(final.split("```sql\n")[1].split("\n```")[0], /^\s*COMMIT;/m);
  assert.match(final, /<GENERATED_LOCALLY>/);
  assert.match(final, /DATABASE_URL/);
});

test("the SQL approval phrase arrived before execution and opens only the SQL gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٣\./);
  assert.match(log, /راجعتُ النص النهائي للمراجعة وأُجيز تنفيذه كدفعة واحدة بـ`ROLLBACK` عند أي فشل/);
  assert.match(log, /مطابقة حرفيًا وقبل التنفيذ/);
  assert.match(log, /موافقة نشر منفصلة/);
  const exec = read("prototypes/finance-app-identity/phase4-sql-EXECUTABLE-APPROVED.md");
  assert.match(exec, /EXECUTABLE/);
  assert.match(exec, /لا تُغيّر `DATABASE_URL`/);
  assert.match(exec, /80 \/ 80 \/ 0/);
  assert.match(exec, /command tag = ROLLBACK/);
  // the reviewed copy is still the non-committing one
  const review = read("prototypes/finance-app-identity/phase4-sql-FINAL-FOR-REVIEW-NOT-EXECUTED.md");
  assert.match(review, /^ROLLBACK;/m);
  assert.match(review, /NOT EXECUTED/);
});

test("a partial phase-4 observation never becomes a commit or deploy proof", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٤\./);
  assert.match(log, /PARTIAL_RESULT_ONLY_NOT_A_PROOF_OF_BATCH_SUCCESS/);
  assert.match(log, /commit_status=UNVERIFIED/);
  assert.match(log, /ONLY_1_OF_4_VERIFICATION_SELECTS_RECEIVED/);
  assert.match(log, /بوابة النشر ما زالت مغلقة/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /overall_release_status: 'NOT_READY'/);
  assert.match(ev, /PARTIAL_RESULT_ONLY_NOT_A_PROOF_OF_BATCH_SUCCESS/);
  assert.match(ev, /DOES_NOT_AUTHORIZE_DATABASE_URL_CHANGE_OR_DEPLOY/);
  assert.doesNotMatch(ev, /COMMIT_CONFIRMED|DEPLOY_READY/);
});

test("matching phase-4 checks still do not confirm a COMMIT or open the deploy gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٥\./);
  assert.match(log, /ALL_OBSERVED_CHECKS_MATCH_BUT_COMMIT_UNVERIFIED/);
  assert.match(log, /commit_status=UNVERIFIED/);
  assert.match(log, /verification_selects_received_of_five=3/);
  assert.match(log, /لا تعني `COMMIT`/);
  assert.match(log, /بوابة النشر مغلقة/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /STATEMENT_EXECUTED_SUCCESSFULLY_IS_NOT_A_COMMIT_CONFIRMATION/);
  assert.match(ev, /RESULTS_OBSERVED_INSIDE_A_TRANSACTION_ARE_NOT_PERSISTENCE/);
  assert.match(ev, /ALL_OBSERVED_CHECKS_MATCH_BUT_COMMIT_UNVERIFIED/);
  assert.doesNotMatch(ev, /COMMIT_CONFIRMED|DEPLOY_READY/);
});

test("an operator COMMIT closes the SQL gate but never changes the deployed identity", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٦\./);
  assert.match(log, /CONFIRMED_BY_OPERATOR/);
  assert.match(log, /CLOSED_SQL_ONLY/);
  assert.match(log, /STILL_NEONDB_OWNER_UNTIL_DATABASE_URL_CHANGED/);
  assert.match(log, /c1_c2_for_deployed_app=FAIL/);
  assert.match(log, /موافقة نشر منفصلة صريحة/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /SEPARATE_DEPLOY_APPROVAL_FOR_DATABASE_URL/);
  assert.match(ev, /OPERATOR_REPORTED_COMMIT_NOT_SESSION_VERIFIED/);
  assert.match(ev, /REQUIRES_C4_C5_BEFORE_ANY_DEPLOY/);
  assert.doesNotMatch(ev, /COMMIT_CONFIRMED|DEPLOY_READY/);
});

test("the separate deploy approval opens only the env-var gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٧\./);
  assert.match(log, /OPEN_ENV_VAR_ONLY/);
  assert.match(log, /DATABASE_URL_VALUE_ONLY_NO_DEPLOY_NO_REENABLE/);
  assert.match(log, /يُمنع `Sync`/);
  assert.match(log, /ENV_CHANGE_TRIGGERS_AUTOMATIC_RESTART_NOT_A_CODE_DEPLOY/);
  const steps = read("prototypes/finance-app-identity/phase5-database-url-steps-APPROVED.md");
  assert.match(steps, /Pooled connection/);
  assert.match(steps, /FINANCE_ENABLED/);
  assert.match(steps, /خطة الرجوع/);
  assert.match(steps, /C4/);
  assert.doesNotMatch(steps, /postgresql:\/\//);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /OPEN_ENV_VAR_ONLY/);
  assert.match(ev, /C4_C5_VERIFICATION_AFTER_ENV_CHANGE/);
  assert.doesNotMatch(ev, /COMMIT_CONFIRMED|DEPLOY_READY/);
});

test("a post-env-change build log is not a connectivity or readiness proof", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٨\./);
  assert.match(log, /FULL_BUILD_AND_DEPLOY_OBSERVED/);
  assert.match(log, /FINANCE_ENABLED_MAY_HAVE_RETURNED_TO_TRUE/);
  assert.match(log, /UNVERIFIED_FROM_LOG/);
  assert.match(log, / LOG_YEAR_ABSENT|بلا سنة/);
  assert.match(log, /فحص `\/setup`/);
  const ev = read("prototypes/finance-app-identity/evaluate-render-deploy-log.mjs");
  assert.match(ev, /SERVICE_LIVE_IS_NOT_DB_CONNECTIVITY_PROOF/);
  assert.match(ev, /BLUEPRINT_MAY_HAVE_REAPPLIED_RENDER_YAML_TRUE/);
  assert.match(ev, /VERIFY_SETUP_AND_FINANCE_ENABLED_THEN_C4_C5/);
  assert.match(ev, /overall_release_status: 'NOT_READY'/);
  assert.doesNotMatch(ev, /DEPLOY_READY|COMMIT_CONFIRMED/);
});

test("the second readiness question is answered with an explicit no", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٤٩\./);
  assert.match(log, /\*\*لا، لسنا جاهزين للنشر\*\*/);
  assert.match(log, /لا يُقرأ السؤال كطلب تغيير نطاق/);
  assert.match(log, /FINANCE_ENABLED_MAY_HAVE_RETURNED_TO_TRUE/);
  assert.match(log, /الخطوة التالية الواحدة/);
  assert.match(log, /قرار منفصل/);
  assert.match(log, /IDENTITY_GAP_CONFIRMED/);
  assert.match(read("docs/finance-app-connection-probe-result-ar.md"), /## ٢٢\./);
});

test("an operator re-enable outside the approval is recorded and must be restored", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٠\./);
  assert.match(log, /انا الذي رجعتها true/);
  assert.match(log, /EXPOSED_BEFORE_C4_C5/);
  assert.match(log, /REENABLE_NOT_COVERED_BY_THE_APPROVAL_PHRASE/);
  assert.match(log, /RESTORE_FALSE_THEN_C4_C5/);
  assert.match(log, /دون نشر أو إعادة تفعيل/);
  assert.match(log, /STRICT_REJECT_POLICY_STILL_IN_FORCE/);
  assert.match(log, /إعادة `FINANCE_ENABLED=false`/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /EXPOSED_BEFORE_C4_C5/);
  assert.match(ev, /NO_ERRORS_IN_LOG_IS_NOT_A_CONNECTIVITY_PROOF/);
  assert.match(ev, /ERRORS_MAY_APPEAR_ONLY_ON_FIRST_WRITE/);
  assert.doesNotMatch(ev, /DEPLOY_READY|COMMIT_CONFIRMED/);
});

test("restoring false is corrective and the second log still hides env values", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥١\./);
  assert.match(log, /رجعتها `FINANCE_ENABLED=false`/);
  assert.match(log, /RESTORED_BUT_UI_UNVERIFIED/);
  assert.match(log, /CORRECTIVE_RETURN_TO_AUTHORIZED_STATE_NOT_A_NEW_APPROVAL/);
  assert.match(log, /log_timestamps_present=false/);
  assert.match(log, /LOG_TIMESTAMPS_ABSENT/);
  assert.match(log, /VERIFY_SETUP_AND_REDIRECT_THEN_C4_C5/);
  const ev = read("prototypes/finance-app-identity/evaluate-render-deploy-log.mjs");
  assert.match(ev, /LOG_DOES_NOT_PRINT_ENV_VALUES/);
  assert.match(read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs"), /VERIFY_SETUP_AND_REDIRECT_THEN_C4_C5/);
});

test("the setup card is a partial UI check and the redirect remains required", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٢\./);
  assert.match(log, /معطّلة مرحليًا/);
  assert.match(log, /RESTORED_SETUP_VERIFIED_REDIRECT_UNVERIFIED/);
  assert.match(log, /financeEnabled_DOES_NOT_DISTINGUISH_FALSE_FROM_MISSING/);
  assert.match(log, /SETUP_CARD_IS_A_UI_INDICATOR_NOT_A_PROCESS_MEASUREMENT/);
  assert.match(log, /VERIFY_FINANCE_REDIRECT_THEN_C4_C5/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /SETUP_CARD_DOES_NOT_PROVE_THE_DATABASE_URL_OR_ROLE/);
  assert.match(ev, /C4_C5_VERIFICATION/);
});

test("an ambiguous surface note is recorded and the C4 plan stays non-executable", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٣\./);
  assert.match(log, /الصفحات الخاصه بالماليه غير موجوده/);
  assert.match(log, /AMBIGUOUS_NEEDS_DISAMBIGUATION/);
  assert.match(log, /DISAMBIGUATE_FINANCE_REDIRECT_THEN_C4_C5/);
  assert.match(log, /ROUTES_EXIST_IN_BUILD_SO_ABSENCE_IS_NOT_DELETION/);
  const plan = read("prototypes/finance-app-identity/c4-rls-triggers-PLAN-DRAFT-NOT-EXECUTABLE.md");
  assert.match(plan, /لا يوجد في هذا الملف أي SQL قابل/);
  assert.match(plan, /BEGIN TRANSACTION READ ONLY/);
  assert.match(plan, /إجازة صريحة منفصلة/);
  assert.match(plan, /NOT_READY/);
  assert.doesNotMatch(plan, /^\s*(CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE)\s/m);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /AMBIGUOUS_NEEDS_DISAMBIGUATION/);
  assert.match(ev, /INVESTIGATE_FINANCE_404_BEFORE_C4_C5/);
});

test("the confirmed redirect opens C4 with a non-executable read-only draft", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٤\./);
  assert.match(log, /يحول الي `dashboard`/);
  assert.match(log, /RESTORED_AND_UI_VERIFIED/);
  assert.match(log, /C4_C5_VERIFICATION/);
  assert.match(log, /SQL_EDITOR_IDENTITY_IS_NEONDB_OWNER_NOT_THE_APP_ROLE/);
  assert.match(log, /إجازة صريحة منفصلة/);
  const draft = read("prototypes/finance-app-identity/c4-read-only-queries-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(draft, /^ROLLBACK;$/m);
  assert.doesNotMatch(draft, /^\s*COMMIT;/m);
  assert.doesNotMatch(draft, /^\s*(CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\s/im);
  assert.match(draft, /pg_get_triggerdef/);
  assert.match(draft, /19/);
  assert.match(read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs"), /C5_REQUIRES_AN_ACTUAL_APP_ROLE_CONNECTION/);
});

test("the C4 draft defect is recorded and v1.1 fixes the FROM clause", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٥\./);
  assert.match(log, /C4_APPROVAL_PHRASE_RECEIVED_BEFORE_EXECUTION/);
  assert.match(log, /SQLSTATE 42P01/);
  assert.match(log, /SESSION_DRAFT_NOT_THE_DATABASE/);
  assert.match(log, /NO_VALID_C4_RESULTS_FROM_THE_FAILED_RUN/);
  assert.match(log, /ACKNOWLEDGE_C4_CORRECTION_THEN_RERUN_READ_ONLY/);
  const draft = read("prototypes/finance-app-identity/c4-read-only-queries-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /DRAFT v1\.1/);
  assert.match(draft, /FROM pg_roles r/);
  assert.match(draft, /^ROLLBACK;$/m);
  assert.doesNotMatch(draft, /^\s*COMMIT;/m);
  assert.doesNotMatch(draft, /^\s*(CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\s/im);
  assert.match(draft, /pg_get_triggerdef/);
  assert.match(draft, /CORRECTED_TEXT_REQUIRES_A_SEPARATE_ACKNOWLEDGMENT|إقرار منفصل قصير/);
  // the defective v1.0 form must not survive anywhere in the draft
  assert.doesNotMatch(draft, /SELECT current_user, session_user,\s*\n\s*r\.rolsuper/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /C4_DRAFT_QUERY1_DEFECT_MISSING_FROM_CLAUSE/);
  assert.match(ev, /ABORTED_TRANSACTION_MUST_BE_ROLLED_BACK_BEFORE_RERUN/);
});

test("C4 partial results are recorded without claiming RLS or trigger verification", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٦\./);
  assert.match(log, /C4_V1_1_ACKNOWLEDGMENT_RECEIVED_BEFORE_EXECUTION/);
  assert.match(log, /PARTIAL_OBJECT_STATE_ONLY/);
  assert.match(log, /COMPLETE_C4_MISSING_OUTPUTS_THEN_C5/);
  assert.match(log, /RLS_DISABLED_EVERYWHERE_SO_RLS_ENFORCEMENT_WAS_NOT_TESTED/);
  assert.match(log, /APP_CAN_CONNECT_IS_A_PRIVILEGE_BIT_NOT_A_LIVE_CONNECTION/);
  assert.match(log, /PRIOR_CLAIM_OF_NO_SELAHTONE_APP_MEMBERSHIP_IS_CORRECTED/);
  assert.match(log, /المحفّزات الـ19/);
  const draft = read("prototypes/finance-app-identity/c4-read-only-queries-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /تصحيح §٥٦/);
  assert.doesNotMatch(draft, /ليس\*\* عضوًا في `selahtone_app`/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /PARTIAL_OBJECT_STATE_ONLY/);
  assert.match(ev, /C5_ACTUAL_APP_ROLE_CONNECTION/);
  assert.match(ev, /triggers_19_verified/);
});

test("a UI success message is recorded as an incomplete C4 result", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٧\./);
  assert.match(log, /Statement executed successfully/);
  assert.match(log, /STATEMENT_EXECUTED_SUCCESSFULLY_IS_A_UI_MESSAGE_NOT_A_RESULT/);
  assert.match(log, /ABSENCE_OF_PASTED_ROWS_IS_NOT_ZERO_ROWS/);
  assert.match(log, /TRIGGERS_19_COUNT_NOT_OBSERVED/);
  assert.match(log, /PASTE_C4_RESULT_SETS_THEN_C4_C5/);
  assert.match(log, /تعذّر التحقق من نتيجة الطلب المحفوظ/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /STILL_PARTIAL_NO_ROW_OUTPUTS_RECEIVED/);
  assert.match(ev, /DO_NOT_INFER_EMPTY_POLICIES_OR_THE_ZERO_ROW_CHECK/);
});

test("the repeated UI message changes the question instead of repeating it", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٨\./);
  assert.match(log, /REPEATED_UI_MESSAGE_IS_NOT_A_RESULT/);
  assert.match(log, /NO_NEW_INFORMATION_SINCE_SECTION_57/);
  assert.match(log, /DO_NOT_REPEAT_THE_SAME_PASTE_REQUEST_A_THIRD_TIME/);
  assert.match(log, /CLARIFY_RESULT_DISPLAY_THEN_PASTE_C4_OUTPUTS/);
  assert.match(log, /FALLBACK_LOCAL_PROBE_REQUIRES_A_SEPARATE_APPROVAL/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /سؤال وصفي واحد مختلف، بلا أي تنفيذ جديد/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /DISAMBIGUATE_WHETHER_THE_EDITOR_DISPLAYS_SELECT_RESULTS/);
  assert.match(ev, /A_GENERIC_UI_MESSAGE_IS_NOT_A_DATABASE_ERROR_OR_ZERO_ROWS/);
});

test("an ambiguous clarification echo selects neither C4/C5 branch", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٥٩\./);
  assert.match(log, /AMBIGUOUS_ECHO_NOT_A_CONFIRMED_ANSWER/);
  assert.match(log, /CONFIRM_ONE_OF_TWO_DISPLAY_OPTIONS/);
  assert.match(log, /FALLBACK_LOCAL_PROBE_REQUIRES_A_SEPARATE_APPROVAL/);
  const plan = read("prototypes/finance-app-identity/c5-local-probe-PLAN-DRAFT-NOT-EXECUTABLE.md");
  assert.match(plan, /غير مُجاز \/ غير قابل للتنفيذ/);
  assert.match(plan, /لا.*DATABASE_URL.*ولا كلمة مرور/);
  assert.match(plan, /موافقة صريحة منفصلة/);
  assert.match(plan, /RLS معطّلة/);
  assert.match(plan, /NOT_READY/);
  assert.doesNotMatch(plan, /^\s*(SELECT|CREATE|GRANT|REVOKE|INSERT|UPDATE|DELETE|BEGIN|COMMIT)\s/im);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /DO_NOT_INFER_THAT_THE_EDITOR_CANNOT_SHOW_RESULTS/);
  assert.match(ev, /YES_THE_MESSAGE_APPEARS_ALONE/);
});

test("the selected local C5 path stays review-only until a separate approval", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٠\./);
  assert.match(log, /YES_THE_MESSAGE_APPEARS_ALONE/);
  assert.match(log, /SQL_EDITOR_CANNOT_SUPPLY_C4_RESULTS/);
  assert.match(log, /REVIEW_C5_LOCAL_PROBE_TEXT_THEN_SEPARATE_APPROVAL/);
  assert.match(log, /d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb/);
  const draft = read("prototypes/finance-app-identity/c5-local-probe-REVIEW-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /غير مُجاز \/ غير قابل للتنفيذ/);
  assert.match(draft, /لا كلمة مرور جديدة ولا تدوير/);
  assert.match(draft, /لا تُرسل إلى الشات/);
  assert.match(draft, /خطة الرجوع/);
  assert.match(draft, /ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP/);
  assert.match(draft, /راجعتُ نص فحص `C5` المحلي وخطة الرجوع/);
  assert.doesNotMatch(draft, /^\s*(SELECT|CREATE|GRANT|REVOKE|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\s/im);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /C5_REQUIRES_A_SEPARATE_EXPLICIT_APPROVAL_PHRASE/);
  assert.match(ev, /DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED/);
});

test("a truncated C5 approval phrase opens no gate and sends no command", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦١\./);
  assert.match(log, /C5_APPROVAL_ATTEMPT_RECEIVED_BEFORE_EXECUTION/);
  assert.match(log, /TRUNCATED_APPROVAL_PHRASE_NOT_VERBATIM/);
  assert.match(log, /RESEND_COMPLETE_C5_APPROVAL_PHRASE/);
  assert.match(log, /NO_GATE_OPENED_AND_NO_COMMAND_SENT/);
  assert.match(log, /resolveNextGate\(\)/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /إعادة إرسال السطر \*\*كاملًا حرفيًا\*\*/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /DO_NOT_EXECUTE_OR_SEND_ANY_COMMAND_BEFORE_THE_EXACT_PHRASE/);
  assert.match(ev, /C5_APPROVAL_PHRASE_IS_NOT_VERIFIED/);
  assert.match(ev, /const resolveNextGate = \(\) =>/);
});

test("the delivered C5 command is secret-free, pinned and rollback-only", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٢\./);
  assert.match(log, /C5_APPROVAL_PHRASE_VERBATIM_BEFORE_EXECUTION/);
  assert.match(log, /RUN_LOCAL_PROBE_THEN_OFFLINE_EVALUATION/);
  assert.match(log, /executed_by_session=false/);
  const cmd = read("prototypes/finance-app-identity/C5-PASTE-IN-TERMINAL-APPROVED.txt");
  assert.match(cmd, /read -r -s DATABASE_URL/);
  assert.match(cmd, /unset DATABASE_URL/);
  assert.match(cmd, /FINANCE_IDENTITY_PROBE_CONFIRM/);
  assert.doesNotMatch(cmd, /postgresql:\/\/|postgres:\/\/|password=|sslmode=/);
  const tool = read("prototypes/finance-app-identity/c5-local-probe-standalone.mjs");
  assert.match(tool, /d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb/);
  assert.match(tool, /POOLED_ENDPOINT_REQUIRED/);
  assert.match(tool, /BEGIN TRANSACTION READ ONLY/);
  assert.match(tool, /ROLLBACK;/);
  assert.doesNotMatch(tool, /^\s*COMMIT;/m);
  assert.match(tool, /ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /COMMAND_DELIVERED_IN_CHAT_NOT_EXECUTED_BY_SESSION/);
  assert.match(ev, /C5_RESULTS_ARE_NOT_YET_RECEIVED_OR_VERIFIED/);
});

test("C5 results are evaluated offline with the 19-trigger scope correction", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٣\./);
  assert.match(log, /SELAHTONE_APP_LIVE_POOLED_CONNECTION/);
  assert.match(log, /TRIGGERS_19_ARE_LAB_ONLY_FINANCE_LAB_NOT_PRODUCTION/);
  assert.match(log, /POST_RUN_CHECK_THEN_SEPARATE_REENABLE_DECISION/);
  assert.match(log, /SSL_WARNING_IS_NON_BLOCKING_NO_SSLMODE_CHANGE_REQUESTED/);
  const draft = read("prototypes/finance-app-identity/c4-read-only-queries-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /تصحيح نطاق المحفّزات الـ19/);
  assert.match(draft, /finance_lab/);
  assert.match(read("prototypes/finance-app-identity/c4-rls-triggers-PLAN-DRAFT-NOT-EXECUTABLE.md"), /تصحيح نطاق المحفّزات الـ19/);
  assert.match(read("prototypes/finance-app-identity/c5-local-probe-REVIEW-DRAFT-NOT-EXECUTABLE.md"), /تصحيح نطاق المحفّزات الـ19/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /ZERO_PRODUCTION_TRIGGERS_IS_NOT_A_TRIGGER_ENFORCEMENT_TEST/);
  assert.match(ev, /POST_RUN_CHECK_THEN_SEPARATE_REENABLE_DECISION/);
});

test("a no-error log report is a partial post-run observation only", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٤\./);
  assert.match(log, /NO_ERROR_IN_LOG_IS_NOT_A_CONNECTIVITY_PROOF/);
  assert.match(log, /PARTIAL_LOG_OBSERVATION_ONLY/);
  assert.match(log, /COMPLETE_POST_RUN_CHECK_THEN_SEPARATE_REENABLE_DECISION/);
  assert.match(log, /FINANCE_IS_DISABLED_SO_NO_FINANCIAL_WRITE_OCCURRED/);
  assert.match(log, /ERRORS_MAY_APPEAR_ONLY_ON_FIRST_WRITE/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /بلا إرسال قيمته/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /ABSENCE_OF_ERRORS_DOES_NOT_PROVE_THE_NEW_ROLE_IS_USED/);
  assert.match(ev, /POST_RUN_CHECK_IS_PARTIAL_LOG_OBSERVATION_ONLY/);
  assert.match(ev, /SEPARATE_REENABLE_DECISION/);
});

test("the completed post-run report is an operator report, not a connectivity proof", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٥\./);
  assert.match(log, /POST_RUN_CHECK_COMPLETE_OPERATOR_REPORT_ONLY_NOT_A_CONNECTIVITY_PROOF/);
  assert.match(log, /OPERATOR_REPORT_NOT_LOG_PROVENANCE/);
  assert.match(log, /DATABASE_URL_REPORTED_SET_BUT_LIVE_APP_ROLE_STILL_UNVERIFIED/);
  assert.match(log, /NO_LIVE_APP_DATABASE_REQUEST_OBSERVED/);
  assert.match(log, /REENABLE_DECISION_NOT_SOLICITED_DO_NOT_SET_FINANCE_ENABLED_TRUE/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /لا أطلب أي عبارة أو إجراء الآن/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /UI_CHECKS_WITH_FINANCE_DISABLED_ARE_NOT_A_CONNECTIVITY_PROOF/);
  assert.match(ev, /REENABLE_DECISION_IS_SEPARATE_AND_NOT_YET_GIVEN/);
  assert.match(ev, /blockers_remaining/);
});

test("a next-step question is procedural and keeps the re-enable gate closed", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٦\./);
  assert.match(log, /PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL/);
  assert.match(log, /OPERATOR_CHOOSES_HOLD_OR_A_SEPARATE_OFFLINE_ANALYSIS_SCOPE/);
  assert.match(log, /HOLD_FINANCE_ENABLED_FALSE_AND_STOP_HERE/);
  assert.match(log, /NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_TRUE/);
  assert.match(log, /REENABLE_DECISION_NOT_SOLICITED_DO_NOT_SET_FINANCE_ENABLED_TRUE/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /اختيارك في الشات/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /THE_NEXT_STEP_IS_AN_OPERATOR_CHOICE_NOT_AN_EXECUTION/);
  assert.match(ev, /REMAINING_BLOCKERS_ARE_NOT_RESOLVED_BY_ASKING_FOR_THE_NEXT_STEP/);
  assert.match(ev, /NO_SECRETS_OR_ROWS_REQUESTED_IN_THE_CHAT/);
});

test("a broad intent to enable and finish everything is refused", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٧\./);
  assert.match(log, /REENABLE_REQUEST_BROAD_INTENT_NOT_A_SEPARATE_VERBATIM_DECISION/);
  assert.match(log, /REENABLE_REQUEST_REFUSED_NOT_READY/);
  assert.match(log, /CLOSED_NOT_READY/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT/);
  assert.match(log, /STRICT_REJECT_POLICY_STILL_IN_FORCE/);
  assert.match(log, /تعذّر التحقق من نتيجة الطلب المحفوظ/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /طلب التشغيل مرفوض/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /REENABLE_GATE_CLOSED_NOT_READY/);
  assert.match(ev, /DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH/);
  assert.match(ev, /NO_FINANCIAL_ACTION_OR_WRITE_OR_REFUND_TEST/);
});

test("the gate roadmap preserves the fixed order and opens nothing", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٨\./);
  assert.match(log, /PROCEDURAL_GATE_PLANNING_QUESTION_NOT_AN_APPROVAL/);
  assert.match(log, /ROADMAP_DELIVERED_IN_CHAT_NOT_A_GATE_AND_NOT_AN_AUTHORIZATION/);
  assert.match(log, /لا موافقة شاملة/);
  assert.match(log, /البوابات التسع المتبقية/);
  assert.match(log, /SEPARATE_EXPLICIT_REENABLE_DECISION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /خريطة البوابات §٦٨/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NO_BLANKET_APPROVAL_FOR_THE_WHOLE_RELEASE/);
  assert.match(ev, /ROADMAP_DOES_NOT_VERIFY_ANY_GATE_OR_ANY_RESULT/);
  assert.match(ev, /gates_to_open_before_readiness/);
});

test("the operator requirements list opens no gate and requests no secret", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٦٩\./);
  assert.match(log, /PROCEDURAL_REQUIREMENTS_QUESTION_NOT_AN_APPROVAL_OR_AUTHORIZATION/);
  assert.match(log, /OPERATOR_REQUIREMENTS_LISTED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /REQUIREMENTS_LIST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(log, /لا يُطلب أي قرار الآن/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /متطلبات المشغّل §٦٩/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NO_APPROVAL_PHRASE_SOLICITED_NO_COMMAND_SENT/);
  assert.match(ev, /DO_NOT_SEND_DATABASE_URL_OR_PASSWORD_OR_ROWS/);
  assert.match(ev, /what_the_operator_must_supply/);
});

test("the offline analysis is TEST ONLY and resolves no blocker", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٠\./);
  assert.match(log, /SEPARATE_EXPLICIT_OFFLINE_ANALYSIS_SCOPE_AUTHORIZATION/);
  assert.match(log, /OFFLINE_ANALYSIS_DELIVERED_NO_GATE_OPENED/);
  assert.match(log, /blockers_resolved=0/);
  assert.match(log, /gates_opened=0/);
  const doc = read("prototypes/finance-app-identity/readiness-blockers-OFFLINE-ANALYSIS-TEST-ONLY.md");
  assert.match(doc, /TEST ONLY/);
  assert.match(doc, /NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE/);
  assert.doesNotMatch(doc, /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|BEGIN|COMMIT|COPY)\b/im);
  assert.doesNotMatch(doc, /postgresql:\/\/|postgres:\/\/|password=|DATABASE_URL=/);
  const inv: { blockers: Array<{ status: string; acceptance_criteria: string; requires: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers.length, 9);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
  assert.ok(inv.blockers.every((b) => b.status === "UNRESOLVED"
    && b.acceptance_criteria && b.requires));
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NO_BLOCKER_IS_RESOLVED_BY_ANALYSIS/);
  assert.match(ev, /NINE_BLOCKERS_REMAIN_UNRESOLVED/);
});

test("the post-analysis next step is one concrete chat-only request", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧١\./);
  assert.match(log, /PROCEDURAL_NEXT_STEP_AFTER_OFFLINE_ANALYSIS/);
  assert.match(log, /ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /DEPLOYED_APP_ROLE_IDENTITY_READ_ONLY_PROOF/);
  assert.match(log, /أجيز إعداد نص مُراجَع للمانع ١ للمراجعة فقط، دون تنفيذ/);
  assert.match(log, /NO_REVIEWED_TEXT_PREPARED_WITHOUT_A_SEPARATE_SCOPE_AUTHORIZATION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /اختيار مانع واحد لنص مُراجَع §٧١/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NO_EXECUTION_APPROVAL_PHRASE_SOLICITED/);
  assert.match(ev, /NEXT_STEP_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("the blocker 1 review draft is TEST ONLY and resolves no blocker", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٢\./);
  assert.match(log, /SEPARATE_EXPLICIT_REVIEW_DRAFT_SCOPE_AUTHORIZATION/);
  assert.match(log, /REVIEW_DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED/);
  assert.match(log, /A_LOCAL_PROBE_PROVES_THE_URL_ROLE_NOT_THE_DEPLOYED_APP_IDENTITY/);
  assert.match(log, /blockers_resolved=0/);
  const draft = read("prototypes/finance-app-identity/blocker-01-deployed-app-identity-REVIEW-DRAFT-NOT-EXECUTABLE.md");
  assert.match(draft, /NOT EXECUTABLE/);
  assert.match(draft, /TEST ONLY/);
  assert.doesNotMatch(draft, /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|BEGIN|COMMIT|COPY)\b/im);
  assert.doesNotMatch(draft, /postgresql:\/\/|postgres:\/\/|password=|DATABASE_URL=/);
  const inv: { blockers: Array<{ status: string; review_draft_status?: string }>; blockers_resolved: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].review_draft_status, "DRAFT_PREPARED_NOT_APPROVED_NOT_EXECUTED");
  assert.equal(inv.blockers_resolved, 0);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /BLOCKER_1_REMAINS_UNRESOLVED/);
  assert.match(ev, /DRAFT_IS_NOT_AN_EXECUTION_APPROVAL_OR_A_REVIEWED_FINAL_TEXT/);
});

test("'OK and execute' is refused and no executable text exists", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٣\./);
  assert.match(log, /NON_VERBATIM_BUNDLED_EXECUTION_REQUEST_AGAINST_A_REVIEW_ONLY_DRAFT/);
  assert.match(log, /EXECUTION_REQUEST_REFUSED_DRAFT_NOT_APPROVED_NOT_EXECUTABLE/);
  assert.match(log, /AN_AMBIGUOUS_ACCEPTANCE_CANNOT_IMPLY_A_VERBATIM_APPROVAL/);
  assert.match(log, /SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS/);
  assert.match(log, /STRICT_REJECT_POLICY_STILL_IN_FORCE/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«موافق و نفذ» مرفوض §٧٣/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NO_COMMAND_SENT_AND_NO_SQL_EXECUTED/);
  assert.match(ev, /BLOCKER_1_REMAINS_UNRESOLVED_AFTER_THE_REFUSAL/);
});

test("the final-for-review text is pinned, read-only and not executed", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٤\./);
  assert.match(log, /ACCEPTANCE_OF_THE_REVIEW_DRAFT_NOT_AN_EXECUTION_APPROVAL/);
  assert.match(log, /FINAL_FOR_REVIEW_TEXT_PREPARED_NOT_APPROVED_NOT_EXECUTED/);
  assert.match(log, /da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a/);
  assert.match(log, /A_LOCAL_PROBE_PROVES_THE_URL_ROLE_NOT_THE_DEPLOYED_APP_IDENTITY/);
  const doc = read("prototypes/finance-app-identity/blocker-01-FINAL-FOR-REVIEW-NOT-EXECUTED.md");
  assert.match(doc, /NOT EXECUTED/);
  const match = doc.match(/```sql\n([\s\S]*?)\n```/);
  assert.ok(match, "SQL block exists");
  const { createHash } = require("node:crypto");
  assert.equal(createHash("sha256").update(match[1], "utf8").digest("hex"),
    "da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a");
  assert.doesNotMatch(match[1], /postgresql:\/\/|postgres:\/\/|password=|DATABASE_URL=/);
  assert.match(match[1], /^BEGIN TRANSACTION READ ONLY;/);
  assert.match(match[1], /ROLLBACK;\s*$/);
  const inv: { blockers: Array<{ status: string; final_text_status?: string; final_sql_sha?: string }>; blockers_resolved: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].final_text_status, "FINAL_FOR_REVIEW_NOT_EXECUTED");
  assert.equal(inv.blockers_resolved, 0);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /FINAL_FOR_REVIEW_TEXT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /ACCEPTANCE_IS_NOT_AN_EXECUTION_APPROVAL/);
});

test("the pasted final-text result is a failed identity check, not a pass", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٥\./);
  assert.match(log, /IDENTITY_CHECK_FAILED_CONNECTION_IS_NEONDB_OWNER_NOT_THE_APP_ROLE/);
  assert.match(log, /current_user = session_user = neondb_owner/);
  assert.match(log, /ACL_REVOKE_IS_INEFFECTIVE_WHEN_A_WRITE_ALL_DATA_ROLE_IS_INHERITED/);
  assert.match(log, /UNSOLICITED_OUTPUT_WITHOUT_A_SEPARATE_VERBATIM_EXECUTION_APPROVAL/);
  assert.match(log, /CONNECTION_SOURCE_IS_NOT_VERIFIED_AS_THE_DEPLOYED_APP/);
  assert.match(log, /blockers_resolved=0/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /نتيجة `neondb_owner` ⇒ فشل §٧٥/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /MANUAL_EXECUTION_OUTSIDE_THE_APPROVAL_ORDER_IS_NOT_RATIFIED/);
  assert.match(ev, /DO_NOT_TREAT_THIS_AS_A_PASS_OR_AS_AN_APPROVAL_OF_ANY_EXECUTION/);
});

test("SQL Editor is out of scope for the deployed-app identity proof", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٦\./);
  assert.match(log, /NON_APP_CONNECTION_OUT_OF_SCOPE_FOR_DEPLOYED_APP_IDENTITY_PROOF/);
  assert.match(log, /FAILED_ON_THIS_CONNECTION_RECLASSIFIED_AS_INAPPLICABLE_OUT_OF_SCOPE/);
  assert.match(log, /database_url_switch=STILL_UNVERIFIED_FROM_LOG/);
  assert.match(log, /AN_IDENTITY_PROBE_FROM_A_CONNECTION_CREATED_INSIDE_THE_DEPLOYED_PROCESS/);
  assert.match(log, /UNRESOLVED_OUT_OF_SCOPE_ADMIN_SESSION_PROVIDES_NO_APP_EVIDENCE/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«SQL Editor» ⇒ خارج النطاق §٧٦/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /EDITOR_SESSION_CANNOT_SUPPLY_DEPLOYED_APP_IDENTITY/);
  assert.match(ev, /RECLASSIFY_SECTION_75_AS_INAPPLICABLE_NOT_A_PASS_OR_FAIL_OF_THE_APP/);
});

test("what should I do advice opens no gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٧\./);
  assert.match(log, /PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL/);
  assert.match(log, /HOLD_FINANCE_ENABLED_FALSE_AND_TAKE_NO_PLATFORM_ACTION/);
  assert.match(log, /SEPARATE_COMMISSION_TO_PREPARE_A_REVIEWED_TEXT_FOR_AN_IN_SERVICE_IDENTITY_PROBE/);
  assert.match(log, /no_reenable_decision_solicited=true/);
  assert.match(log, /ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«قولي اعمل ايه» ⇒ خطوة واحدة §٧٧/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /PROCEDURAL_ADVICE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /DO_NOT_REPEAT_THE_SQL_EDITOR_PROBE/);
});

test("probe source guidance opens no gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٨\./);
  assert.match(log, /SOURCE_OF_EVIDENCE_EXPLAINED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /ONLY_A_CONNECTION_CREATED_BY_THE_DEPLOYED_PROCESS_ITSELF_USING_ITS_OWN_RUNTIME_CONFIG/);
  assert.match(log, /SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS/);
  assert.match(log, /NEON_SQL_EDITOR_ADMIN_SESSION/);
  assert.match(log, /database_url_switch=UNVERIFIED_FROM_LOG/);
  assert.match(log, /no_executable_sql_delivered=true/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«اجيب منين …» ⇒ مصدر الإثبات §٧٨/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /PROCEDURAL_GUIDANCE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /IN_SERVICE_PROBE_REQUIRES_SEPARATE_SRC_AND_DEPLOY_APPROVALS/);
});

test("repeated next step question opens no gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٧٩\./);
  assert.match(log, /PROCEDURAL_NEXT_STEP_QUESTION_NOT_A_DECISION_OR_APPROVAL/);
  assert.match(log, /ONE_CONCRETE_REQUEST_DELIVERED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /SEPARATE_COMMISSION_TO_PREPARE_A_REVIEWED_IN_SERVICE_IDENTITY_PROBE_TEXT_FOR_REVIEW_ONLY/);
  assert.match(log, /NOT_A_VERBATIM_APPROVAL_NOT_AN_EXECUTION_REQUEST_NOT_A_REENABLE_DECISION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«ما الخطوه التاليه» ⇒ طلب واحد §٧٩/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /PROCEDURAL_NEXT_STEP_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /DO_NOT_REPEAT_THE_SQL_EDITOR_PROBE/);
});

test("direct execution request is refused in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٠\./);
  assert.match(log, /DIRECT_EXECUTION_REQUEST_REFUSED_NOT_READY/);
  assert.match(log, /NO_COMMAND_NO_SQL_NO_GATE_NO_ACTION/);
  assert.match(log, /SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS/);
  assert.match(log, /AN_AMBIGUOUS_ACCEPTANCE_CANNOT_IMPLY_A_VERBATIM_APPROVAL/);
  assert.match(log, /finance_enabled=false/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«انا اريد تنفيذ مباشره» مرفوض §٨٠/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /EXECUTION_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_FINANCIAL_ACTION/);
});

test("approval delivery mechanism opens no gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨١\./);
  assert.match(log, /APPROVAL_DELIVERY_MECHANISM_EXPLAINED_IN_CHAT_NO_PHRASE_SOLICITED/);
  assert.match(log, /PLAIN_CHAT_MESSAGE_ONLY/);
  assert.match(log, /NO_DATABASE_URL_NO_PASSWORD_NO_ROWS_NO_SECRETS/);
  assert.match(log, /no_approval_template_delivered=true/);
  assert.match(log, /APPROVAL_DOES_NOT_OPEN_THE_REENABLE_GATE/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«كيف ارسلك نص الموافقه» ⇒ شرح الآلية §٨١/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NO_APPROVAL_PHRASE_SOLICITED_AND_NO_TEMPLATE_DELIVERED/);
  assert.match(ev, /PROCEDURAL_GUIDANCE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("bare approval is refused in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٢\./);
  assert.match(log, /AMBIGUOUS_BARE_APPROVAL_REFUSED_NOT_VERBATIM/);
  assert.match(log, /TRUNCATED_BARE_APPROVAL_NOT_A_SEPARATE_VERBATIM_APPROVAL/);
  assert.match(log, /تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم\./);
  assert.match(log, /NO_COMMAND_NO_SQL_NO_GATE_NO_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«موافق» مرفوضة §٨٢/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /BARE_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /STRICT_REJECT_POLICY_STILL_IN_FORCE/);
});

test("bundled approvals are refused in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٣\./);
  assert.match(log, /BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /IN_SERVICE_REVIEWED_TEXT_NOT_PREPARED_YET/);
  assert.match(log, /APPROVAL_POINTS_AT_THE_OLD_SECTION_74_TEXT_OUT_OF_SCOPE/);
  assert.match(log, /ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL/);
  assert.match(log, /da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /الموافقات المرقّمة مرفوضة §٨٣/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /BUNDLED_APPROVALS_DO_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE/);
});

test("approval shape guidance opens no gate", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٤\./);
  assert.match(log, /APPROVAL_SHAPE_EXPLAINED_STEP_BY_STEP_NO_TEMPLATE_NO_PHRASE_SOLICITED/);
  assert.match(log, /IN_SERVICE_REVIEWED_TEXT_NOT_PREPARED_YET_AND_NO_PHRASE_SOLICITED/);
  assert.match(log, /NAMES_THE_PINNED_TEXT_BY_ITS_SHA/);
  assert.match(log, /EXECUTION_BY_THE_OPERATOR_NOT_THE_SESSION/);
  assert.match(log, /SEPARATE_REENABLE_DECISION_NOT_SOLICITED/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«قل لي بالتحديد خطوه خطوه» ⇒ الشكل §٨٤/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /APPROVAL_SHAPE_GUIDANCE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /NO_APPROVAL_TEMPLATE_DELIVERED_AND_NO_PHRASE_SOLICITED/);
});

test("current step is step 1 in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٥\./);
  assert.match(log, /CURRENT_STEP_IDENTIFIED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /HOLD_FINANCE_ENABLED_FALSE_NO_PLATFORM_ACTION/);
  assert.match(log, /current_step_index=1/);
  assert.match(log, /in_service_reviewed_text_prepared=false/);
  assert.match(log, /NOT_RECEIVED_AS_A_SEPARATE_APPROVED_COMMISSION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«احنا في خطوه الان؟» ⇒ الخطوة ١ §٨٥/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /CURRENT_STEP_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /ALL_PRIOR_APPROVALS_WERE_REFUSED_STRICT_REJECT/);
});

test("hold acknowledgment is recorded in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٦\./);
  assert.match(log, /ACKNOWLEDGMENT_OF_THE_HOLD_STATUS_NOT_AN_EXECUTION_APPROVAL/);
  assert.match(log, /HOLD_ACKNOWLEDGED_STATUS_UNCHANGED_NO_GATE_OPENED/);
  assert.match(log, /DOES_NOT_ADVANCE_TO_STEP_2_OR_PREPARE_ANY_TEXT/);
  assert.match(log, /step_2_commission=STILL_NOT_RECEIVED/);
  assert.match(log, /is_an_execution_approval=false/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«موافق علي HOLD» ⇒ إقرار §٨٦/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /HOLD_ACKNOWLEDGMENT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /STATUS_CONFIRMED_STILL_AT_STEP_1_NO_GATE_OPENED/);
});

test("refusal reasons are explained in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٧\./);
  assert.match(log, /REFUSAL_REASONS_EXPLAINED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES/);
  assert.match(log, /APPROVAL_POINTS_AT_THE_OLD_SECTION_74_TEXT_OUT_OF_SCOPE/);
  assert.match(log, /HOLD_WAS_ACKNOWLEDGED_NOT_REFUSED/);
  assert.match(log, /SECTION_82_BARE_OK/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«لماذا مرفوضه» ⇒ شرح الأسباب §٨٧/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /REFUSAL_EXPLANATION_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("repeated hold acknowledgment is recorded in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٨\./);
  assert.match(log, /DUPLICATE_HOLD_CONFIRMATION_RECORDED_STATUS_UNCHANGED_NO_GATE_OPENED/);
  assert.match(log, /REPEATED_HOLD_ACKNOWLEDGMENT_NOT_AN_EXECUTION_APPROVAL/);
  assert.match(log, /BARE_OK_HAD_NO_EXPLICIT_STATE_REFERENCE/);
  assert.match(log, /NAMED_HOLD_IS_NOT_A_BARE_OK/);
  assert.match(log, /no_new_information=true/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /تكرار «HOLD… موافق» ⇒ إقرار مكرر §٨٨/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /REPEATED_ACKNOWLEDGMENT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("continue request is refused in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٨٩\./);
  assert.match(log, /CONTINUE_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /AMBIGUOUS_CONTINUE_REQUEST_NOT_A_SEPARATE_COMMISSION_OR_APPROVAL/);
  assert.match(log, /DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH/);
  assert.match(log, /STATUS_STILL_STEP_1_NO_GATE_OPENED/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«اكمل» مرفوضة §٨٩/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /CONTINUE_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /CONTINUE_IS_NOT_A_SEPARATE_COMMISSION_OR_APPROVAL/);
});

test("remaining steps roadmap is in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٠\./);
  assert.match(log, /REMAINING_STEPS_LISTED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /NO_BLANKET_APPROVAL_EACH_BLOCKER_NEEDS_ITS_OWN_SEPARATE_CYCLE/);
  assert.match(log, /DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED/);
  assert.match(log, /PROHIBITED_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT/);
  assert.match(log, /REENABLE_GATE_CLOSED_AND_DECISION_NOT_SOLICITED/);
  assert.match(log, /remaining_blockers=9/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /خريطة الطريق §٩٠/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /ROADMAP_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("separate commission reviewed text is pinned in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩١\./);
  assert.match(log, /SEPARATE_EXPLICIT_COMMISSION_FOR_A_REVIEW_ONLY_TEXT/);
  assert.match(log, /REVIEWED_TEXT_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED/);
  assert.match(log, /629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e/);
  assert.match(log, /REVIEWED_TEXT_PREPARATION_ONLY/);
  const doc = read("prototypes/finance-app-identity/in-service-identity-probe-REVIEWED-TEXT-NOT-EXECUTABLE.md");
  assert.match(doc, /NOT EXECUTABLE/);
  assert.doesNotMatch(doc, /```sql/);
  const m = doc.match(/```text\n([\s\S]*?)\n```/);
  assert.ok(m, "spec block exists");
  const { createHash } = require("node:crypto");
  assert.equal(createHash("sha256").update(m[1], "utf8").digest("hex"),
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  const inv: { blockers: Array<{ status: string; in_service_reviewed_text_status?: string }>; blockers_resolved: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].in_service_reviewed_text_status,
    "REVIEWED_TEXT_PREPARED_FOR_REVIEW_ONLY");
  assert.equal(inv.blockers_resolved, 0);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /REVIEWED_TEXT_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("ambiguous text approval is refused in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٢\./);
  assert.match(log, /TEXT_APPROVAL_REFUSED_STRICT_REJECT_NOT_VERBATIM/);
  assert.match(log, /AMBIGUOUS_TEXT_APPROVAL_NOT_A_SEPARATE_VERBATIM_APPROVAL/);
  assert.match(log, /629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e/);
  assert.match(log, /HOLD_NAMED_A_FULL_EXACT_STATE_TOKEN_THIS_NAMES_ONLY_A_GENERIC_NOUN/);
  assert.match(log, /DO_NOT_TREAT_AS_THE_SEPARATE_VERBATIM_APPROVAL_OF_STEP_5/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«موافق علي النص» مرفوضة §٩٢/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /TEXT_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("named text approval is recorded in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٣\./);
  assert.match(log, /NAMED_TEXT_ACKNOWLEDGED_STEP_5_STILL_CLOSED_STRICT_REJECT/);
  assert.match(log, /GENERIC_NOUN_UPGRADED_TO_AN_EXACT_SUBJECT_BUT_SHA_STILL_ABSENT/);
  assert.match(log, /A_FIXED_CONDITION_CANNOT_BE_WAIVED_BY_THE_SESSION/);
  assert.match(log, /step_5_approval_received=false/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«موافق علي نص مسار الفحص داخل الخدمة» ⇒ إقرار وصفي §٩٣/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NAMED_TEXT_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("verbatim approval with pinned sha is in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٤\./);
  assert.match(log, /VERBATIM_APPROVAL_ACCEPTED_REVIEW_ONLY_TEXT_STEP_5_CLOSED_NO_GATE_OPENED/);
  assert.match(log, /SEPARATE_VERBATIM_APPROVAL_OF_THE_PINNED_REVIEWED_TEXT/);
  assert.match(log, /sha_verified=true/);
  assert.match(log, /REVIEWED_TEXT_ONLY_NOT_EXECUTION/);
  assert.match(log, /SEPARATE_ROLLBACK_PLAN_THEN_ITS_SEPARATE_APPROVAL/);
  const inv: { blockers: Array<{ status: string; verbatim_approval_sha?: string; step_5_verbatim_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers[0].verbatim_approval_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /VERBATIM_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("pinned sha execution request is refused in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٥\./);
  assert.match(log, /PINNED_SHA_EXECUTION_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /REQUESTED_TEXT_IS_REVIEW_ONLY_NOT_EXECUTABLE/);
  assert.match(log, /SHA_ALONE_IS_NOT_AN_EXECUTION_AUTHORIZATION/);
  assert.match(log, /ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL/);
  assert.match(log, /SEPARATE_IN_SERVICE_PATH_APPROVAL_MISSING/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«نفذ» بالبصمة مرفوض §٩٥/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /EXECUTION_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  const inv: { blockers: Array<{ status: string; step_5_verbatim_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("rollback plan topic is recorded in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٦\./);
  assert.match(log, /ROLLBACK_PLAN_NAMED_BUT_NOT_PREPARED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /SHA_IDENTIFIES_THE_REVIEWED_TEXT_NOT_A_ROLLBACK_PLAN/);
  assert.match(log, /A_PLAN_CANNOT_BE_APPROVED_BEFORE_IT_IS_PREPARED/);
  assert.match(log, /BARE_TOPIC_LABEL_IS_NOT_AN_EXPLICIT_SEPARATE_COMMISSION/);
  assert.match(log, /rollback_plan_prepared=false/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«خطة الرجوع المنفصلة» بالبصمة ⇒ تسمية لا خطة §٩٦/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /ROLLBACK_PLAN_TOPIC_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES/);
  const inv: { blockers: Array<{ status: string; step_5_verbatim_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("separate rollback plan is pinned in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٧\./);
  assert.match(log, /SEPARATE_EXPLICIT_COMMISSION_FOR_A_REVIEW_ONLY_ROLLBACK_PLAN/);
  assert.match(log, /ROLLBACK_PLAN_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED/);
  assert.match(log, /NO_APPROVAL_IS_BUNDLED_WITH_THE_ROLLBACK_PLAN/);
  assert.match(log, /OPERATOR_REVIEWS_THE_ROLLBACK_PLAN/);
  const doc = read("prototypes/finance-app-identity/separate-rollback-plan-REVIEW-ONLY-NOT-EXECUTABLE.md");
  assert.match(doc, /NOT EXECUTABLE/);
  assert.match(doc, /TEST ONLY/);
  assert.match(doc, /629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e/);
  assert.doesNotMatch(doc, /```sql/);
  const m = doc.match(/```text\n([\s\S]*?)\n```/);
  assert.ok(m, "plan block exists");
  const { createHash } = require("node:crypto");
  assert.equal(createHash("sha256").update(m[1], "utf8").digest("hex"),
    "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  for (const c of ["B1", "B2", "B3", "B4", "B5", "B6"]) assert.match(m[1], new RegExp(c));
  assert.match(m[1], /SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS/);
  const inv: { blockers: Array<{ status: string; rollback_plan_sha?: string; rollback_plan_status?: string; step_5_verbatim_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].rollback_plan_sha, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(inv.blockers[0].rollback_plan_status, "ROLLBACK_PLAN_PREPARED_FOR_REVIEW_ONLY");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«اعد خطة الرجوع المنفصلة» ⇒ خطة مُعدّة §٩٧/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /ROLLBACK_PLAN_PREPARATION_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
});

test("rollback plan verbatim approval is in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٨\./);
  assert.match(log, /SEPARATE_VERBATIM_APPROVAL_OF_THE_ROLLBACK_PLAN_ONLY/);
  assert.match(log, /SEPARATE_ROLLBACK_PLAN_APPROVAL_ACCEPTED_NO_GATE_OPENED/);
  assert.match(log, /ROLLBACK_PLAN_TEXT_ONLY_NOT_EXECUTION/);
  assert.match(log, /NO_APPROVAL_IS_BUNDLED_WITH_THE_ROLLBACK_PLAN/);
  assert.match(log, /SEPARATE_IN_SERVICE_PATH_APPROVAL/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /الموافقة بالبصمة على الخطة ⇒ مقبولة §٩٨/);
  const inv: { blockers: Array<{ status: string; separate_rollback_plan_approval_sha?: string; separate_rollback_plan_approval_received?: boolean; rollback_plan_sha?: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_received, true);
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_sha, "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_sha, inv.blockers[0].rollback_plan_sha);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /ROLLBACK_PLAN_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /ROLLBACK_PLAN_SHA_VERIFIED_AGAINST_THE_PINNED_BLOCK/);
});

test("next step question after plan approval is in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ٩٩\./);
  assert.match(log, /PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL/);
  assert.match(log, /NEXT_DESCRIPTIVE_STEP_IDENTIFIED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /DESCRIPTIVE_ONLY_NO_TEMPLATE_NO_PHRASE_SOLICITED/);
  assert.match(log, /SEPARATE_IN_SERVICE_PATH_APPROVAL/);
  assert.match(log, /current_step_index=6/);
  assert.match(log, /REENABLE_GATE_CLOSED_AND_DECISION_NOT_SOLICITED/);
  assert.match(log, /DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«ما الخطوه التاليه ؟» ⇒ الخطوة ٦ §٩٩/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /NEXT_STEP_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /NO_APPROVAL_PHRASE_SOLICITED_AND_NO_TEMPLATE_DELIVERED/);
  const inv: { blockers: Array<{ status: string; step_5_verbatim_approval_received?: boolean; separate_rollback_plan_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("in-service path topic is recorded in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٠\./);
  assert.match(log, /IN_SERVICE_PATH_TOPIC_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /BARE_NOUN_PHRASE_IS_NOT_A_SEPARATE_VERBATIM_APPROVAL/);
  assert.match(log, /references_pinned_sha=false/);
  assert.match(log, /DO_NOT_INFER_PERMISSION_FROM_AN_INTENT_TO_FINISH/);
  assert.match(log, /SRC_AND_DEPLOY_APPROVALS_ARE_STILL_MISSING/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«إدخال مسار الفحص داخل العملية» ⇒ تسمية موضوع §١٠٠/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /IN_SERVICE_PATH_TOPIC_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  const inv: { blockers: Array<{ status: string; step_5_verbatim_approval_received?: boolean; separate_rollback_plan_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("both pinned shas message is recorded in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠١\./);
  assert.match(log, /IN_SERVICE_PATH_NAMED_WITH_BOTH_PINNED_SHAS_NOT_AN_APPROVAL/);
  assert.match(log, /BOTH_PINNED_SHAS_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /BOTH_PINNED_SHAS_VERIFIED_AGAINST_THE_BLOCKS_AND_INVENTORY/);
  assert.match(log, /both_shas_verified=true/);
  assert.match(log, /SHAS_IDENTIFY_BUT_DO_NOT_AUTHORIZE_EXECUTION/);
  assert.match(log, /SRC_AND_DEPLOY_APPROVALS_ARE_STILL_MISSING/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /تكراره بالبصمتين ⇒ إقرار وصفي §١٠١/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /PINNED_SHAS_MESSAGE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  const inv: { blockers: Array<{ status: string; in_service_reviewed_text_sha?: string; rollback_plan_sha?: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].in_service_reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(inv.blockers[0].rollback_plan_sha,
    "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("bundled path src deploy approval is refused in section 102", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٢\./);
  assert.match(log, /BUNDLED_IN_SERVICE_PATH_SRC_AND_DEPLOY_APPROVAL_NOT_SEPARATE/);
  assert.match(log, /BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE/);
  assert.match(log, /SRC_MODIFICATION_AND_DEPLOY_ARE_PROHIBITED/);
  assert.match(log, /DEPLOY_AND_SYNC_AND_TRUE_ARE_PROHIBITED/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /الموافقات المجمَّعة بالمسار و`src` والنشر مرفوضة §١٠٢/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /BUNDLED_APPROVAL_MESSAGE_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE/);
  const inv: { blockers: Array<{ status: string; step_5_verbatim_approval_received?: boolean; separate_rollback_plan_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("multi-line bundled approvals are refused in section 103", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٣\./);
  assert.match(log, /MULTI_LINE_BUNDLED_APPROVALS_STILL_ONE_SINGLE_CHAT_MESSAGE/);
  assert.match(log, /MULTI_LINE_BUNDLED_APPROVALS_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /SEPARATE_LINES_DO_NOT_CREATE_SEPARATE_STANDALONE_MESSAGES/);
  assert.match(log, /is_three_separate_messages=false/);
  assert.match(log, /SRC_MODIFICATION_AND_DEPLOY_ARE_PROHIBITED/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /تكرارها بأسطر منفصلة مرفوض §١٠٣/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /MULTI_LINE_BUNDLED_APPROVALS_DO_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /SEPARATE_LINES_DO_NOT_CREATE_SEPARATE_STANDALONE_MESSAGES/);
  const inv: { blockers: Array<{ status: string; step_5_verbatim_approval_received?: boolean; separate_rollback_plan_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("separate in-service path approval is in the log", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٤\./);
  assert.match(log, /SEPARATE_VERBATIM_APPROVAL_OF_THE_IN_SERVICE_PATH_ONLY/);
  assert.match(log, /SEPARATE_IN_SERVICE_PATH_APPROVAL_ACCEPTED_NO_GATE_OPENED/);
  assert.match(log, /IN_SERVICE_PATH_ONLY_NOT_SRC_NOT_DEPLOY_NOT_EXECUTION/);
  assert.match(log, /both_shas_verified=true/);
  assert.match(log, /SEPARATE_SRC_AND_DEPLOY_APPROVALS_IF_NEEDED/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /موافقة المسار وحدها بالبصمتين ⇒ مقبولة §١٠٤/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /SEPARATE_IN_SERVICE_PATH_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /ONE_STANDALONE_APPROVAL_WITH_BOTH_PINNED_SHAS_INLINE/);
  const inv: { blockers: Array<{ status: string; in_service_reviewed_text_sha?: string; rollback_plan_sha?: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].in_service_reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(inv.blockers[0].rollback_plan_sha,
    "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("standalone src only approval is refused in section 105", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٥\./);
  assert.match(log, /SRC_ONLY_APPROVAL_WITHOUT_A_PINNED_REVIEWED_TEXT/);
  assert.match(log, /SRC_ONLY_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS/);
  assert.match(log, /APPROVAL_CANNOT_PRECEDE_THE_PINNED_TEXT_IT_NAMES/);
  assert.match(log, /references_pinned_sha=false/);
  assert.match(log, /SRC_MODIFICATION_IS_PROHIBITED/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«موافق علي `src`» مرفوضة §١٠٥/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /SRC_ONLY_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS/);
  const inv: { blockers: Array<{ status: string; step_5_verbatim_approval_received?: boolean; separate_rollback_plan_approval_received?: boolean }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].step_5_verbatim_approval_received, true);
  assert.equal(inv.blockers[0].separate_rollback_plan_approval_received, true);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("stale sha src approval is refused in section 106", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٦\./);
  assert.match(log, /SRC_APPROVAL_PINNED_TO_AN_OLD_UNRELATED_PROBE_SHA/);
  assert.match(log, /STALE_SHA_SRC_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /APP_CONNECTION_PROBE_V1_1_READ_ONLY_SQL/);
  assert.match(log, /OLD_UNRELATED_PROBE_SHA_IS_NOT_A_CURRENT_PINNED_TEXT/);
  assert.match(log, /NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /تكرارها ببصمة الفحص القديمة مرفوض §١٠٦/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /STALE_SHA_SRC_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /OLD_UNRELATED_PROBE_SHA_IS_NOT_A_CURRENT_PINNED_TEXT/);
  const { createHash } = require("node:crypto");
  assert.equal(createHash("sha256").update(read("prototypes/finance-app-identity/app-connection-probe.test-only.sql"), "utf8").digest("hex"),
    "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb");
  const inv: { blockers: Array<{ status: string; in_service_reviewed_text_sha?: string; rollback_plan_sha?: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].in_service_reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(inv.blockers[0].rollback_plan_sha,
    "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("src modification approval with current shas is refused in section 107", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٧\./);
  assert.match(log, /SRC_MODIFICATION_APPROVAL_WITH_CURRENT_BUT_UNRELATED_SHAS/);
  assert.match(log, /SRC_MODIFICATION_APPROVAL_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /IN_SERVICE_REVIEWED_TEXT_AND_ROLLBACK_PLAN_NOT_A_SRC_ARTIFACT/);
  assert.match(log, /NO_REVIEWED_TEXT_FOR_SRC_CHANGES_EXISTS/);
  assert.match(log, /both_current_shas_verified=true/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /«موافق علي التعديل علي `src`» بالبصمتين مرفوض §١٠٧/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /SRC_MODIFICATION_APPROVAL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /BOTH_CURRENT_PINNED_SHAS_VERIFIED_BUT_THEY_IDENTIFY_OTHER_ARTIFACTS/);
  const inv: { blockers: Array<{ status: string; in_service_reviewed_text_sha?: string; rollback_plan_sha?: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers[0].in_service_reviewed_text_sha,
    "629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e");
  assert.equal(inv.blockers[0].rollback_plan_sha,
    "3a54fa51d91d40d6dab25ce1dcda6c86371a9872f716eff76c01148927fd703c");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("ratification of a refused src approval with deploy is refused in section 108", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٨\./);
  assert.match(log, /APPROVAL_OF_A_PRIOR_REFUSED_SRC_APPROVAL_BUNDLED_WITH_DEPLOY/);
  assert.match(log, /RATIFICATION_OF_REFUSED_SRC_APPROVAL_AND_DEPLOY_BUNDLE_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /A_REFUSED_APPROVAL_CANNOT_BE_RATIFIED_INTO_A_VALID_ONE/);
  assert.match(log, /NO_BLANKET_APPROVAL_EACH_APPROVAL_NEEDS_ITS_OWN_SEPARATE_MESSAGE/);
  assert.match(log, /prior_refused_sections=\[105,106,107\]/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /تصديقها مع النشر مرفوض §١٠٨/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /RATIFICATION_AND_DEPLOY_BUNDLE_DO_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /A_REFUSED_APPROVAL_CANNOT_BE_RATIFIED_INTO_A_VALID_ONE/);
  const inv: { blockers: Array<{ status: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("old request migration label is refused in section 109", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١٠٩\./);
  assert.match(log, /OLD_REQUEST_MIGRATION_LABEL_WITH_CURRENT_PINNED_SHAS/);
  assert.match(log, /OLD_REQUEST_MIGRATION_LABEL_ACKNOWLEDGED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /A_LABEL_NAMING_THE_REMEDY_IS_NOT_PERFORMING_THE_REMEDY/);
  assert.match(log, /SESSION_DOES_NOT_MIGRATE_OR_REVALIDATE_A_REFUSED_REQUEST/);
  assert.match(log, /no_inventory_change=true/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /تسمية «ترحيل الطلب القديم» مرفوض §١٠٩/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /MIGRATION_LABEL_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /A_LABEL_NAMING_THE_REMEDY_IS_NOT_PERFORMING_THE_REMEDY/);
  const inv: { blockers: Array<{ status: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("remaining steps and deploy question is answered in section 110", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١١٠\./);
  assert.match(log, /PROCEDURAL_QUESTION_ABOUT_REMAINING_WORK_AND_DEPLOY/);
  assert.match(log, /PROCEDURAL_QUESTION_ANSWERED_WITH_REMAINING_STEPS_NO_GATE_OPENED/);
  assert.match(log, /REMAINING_STEPS_LISTED_IN_CHAT_NO_GATE_OPENED/);
  assert.match(log, /deploy_status=PROHIBITED_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT/);
  assert.match(log, /no_phrase_delivered=true/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /سؤال المتبقي والخطوات ⇒ إجابة وصفية §١١٠/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /REMAINING_STEPS_ANSWER_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /PROCEDURAL_QUESTION_NOT_A_DECISION_OR_APPROVAL/);
  const inv: { blockers: Array<{ status: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers.length, 9);
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("advance to next step request is refused in section 111", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١١١\./);
  assert.match(log, /REQUEST_TO_ADVANCE_TO_THE_NEXT_STEP/);
  assert.match(log, /ADVANCE_TO_NEXT_STEP_REQUEST_REFUSED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /SESSION_CANNOT_ADVANCE_OR_OPEN_A_STEP_OR_GATE/);
  assert.match(log, /AN_INTENT_TO_PROCEED_IS_NOT_A_SEPARATE_VERBATIM_APPROVAL/);
  assert.match(log, /no_phrase_delivered=true/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /طلب الانتقال للخطوة التالية مرفوض §١١١/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /ADVANCE_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /SESSION_CANNOT_ADVANCE_OR_OPEN_A_STEP_OR_GATE/);
  const inv: { blockers: Array<{ status: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("src reviewed text topic label is refused in section 112", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١١٢\./);
  assert.match(log, /BARE_NOUN_PHRASE_NAMING_A_SRC_REVIEWED_TEXT/);
  assert.match(log, /SRC_REVIEWED_TEXT_TOPIC_NAMED_STRICT_REJECT_NOT_ACTIONABLE/);
  assert.match(log, /A_NOUN_PHRASE_NAMING_AN_ARTIFACT_IS_NOT_PREPARING_IT/);
  assert.match(log, /SESSION_DOES_NOT_AUTHOR_REVIEWED_SRC_TEXT/);
  assert.match(log, /no_text_body_provided=true/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const steps = read("docs/finance-identity-remediation-steps-ar.md");
  assert.match(steps, /تسمية «نص مُراجَع لتغييرات `src`» مرفوضة §١١٢/);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /SRC_REVIEWED_TEXT_TOPIC_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /fs\.writeSync\(1, text/);
  assert.doesNotMatch(ev, /process\.exit\(ok \? 0 : 0\)/);
  const inv: { blockers: Array<{ status: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("pull request is repository only in section 113", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١١٣\./);
  assert.match(log, /PULL_REQUEST_OPENED_REPOSITORY_ONLY_NO_GATE_OPENED/);
  assert.match(log, /PULL_REQUEST_IS_NOT_AN_APPROVAL_AND_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(log, /git diff -- render.yaml/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const probe = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(probe, /## ٨٦\./);
  const inv: { blockers: Array<{ status: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});

test("merge request is refused in section 114", () => {
  const log = read("docs/finance-release-log.md");
  assert.match(log, /## ١١٤\./);
  assert.match(log, /DIRECT_MERGE_REQUEST_AGAINST_A_NOT_READY_BRANCH/);
  assert.match(log, /MERGE_REQUEST_REFUSED_NOT_READY_NO_DEPLOY/);
  assert.match(log, /MERGE_TO_MAIN_WOULD_DEPLOY_AND_CHANGE_PRODUCTION_SRC/);
  assert.match(log, /PULL_REQUEST_STAYS_OPEN_NOT_MERGED/);
  assert.match(log, /no_merge_performed=true/);
  assert.match(log, /NO_TRUE_NO_DEPLOY_NO_SYNC_NO_MANUAL_DEPLOY_NO_BLUEPRINT_NO_SQL_NO_SRC_NO_RENDER_YAML_NO_FINANCIAL_ACTION/);
  const probe = read("docs/finance-app-connection-probe-result-ar.md");
  assert.match(probe, /## ٨٧\./);
  const ev = read("prototypes/finance-app-identity/evaluate-phase4-execution.mjs");
  assert.match(ev, /MERGE_REQUEST_DOES_NOT_VERIFY_OR_CLOSE_ANY_GATE/);
  assert.match(ev, /MERGE_TO_MAIN_WOULD_DEPLOY_AND_CHANGE_PRODUCTION_SRC/);
  const inv: { blockers: Array<{ status: string }>; blockers_resolved: number; gates_opened: number } = JSON.parse(read("prototypes/finance-app-identity/readiness-blockers-inventory.test-only.json"));
  assert.equal(inv.blockers[0].status, "UNRESOLVED");
  assert.equal(inv.blockers_resolved, 0);
  assert.equal(inv.gates_opened, 0);
});
