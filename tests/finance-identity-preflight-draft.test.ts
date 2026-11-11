/**
 * TEST ONLY — static guard on the DRAFT preflight query embedded in
 * docs/finance-identity-remediation-steps-ar.md. No database connection,
 * no production read, no secrets. It keeps the draft read-only, rollback-ended,
 * and free of anything that would print a database/schema name or credentials.
 *
 * The draft is NOT authorized to run. This test only guards its text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const log = readFileSync(path.join(process.cwd(), "docs/finance-release-log.md"), "utf8");

const md = readFileSync(
  path.join(process.cwd(), "docs/finance-identity-remediation-steps-ar.md"),
  "utf8",
);
const sql = md.split("```sql\n")[1].split("\n```")[0];
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

test("the draft is wrapped in a read-only transaction that always rolls back", () => {
  assert.match(code, /^\s*BEGIN TRANSACTION READ ONLY;/m);
  assert.match(code, /SET LOCAL statement_timeout\s*=\s*'15s';/);
  assert.match(code, /^\s*ROLLBACK;\s*$/m);
  assert.match(md, /غير مُجاز للتنفيذ/);
  assert.match(md, /اختُبرت نحويًا/);
});

test("the draft contains no write, DDL or DCL statements", () => {
  assert.doesNotMatch(
    code,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|REASSIGN|VACUUM|REINDEX|COMMENT|SECURITY\s+LABEL)\b|SET\s+ROLE/i,
    "a preflight inventory must never change the database",
  );
  assert.match(code, /pg_auth_members/);
  assert.match(code, /relrowsecurity/);
});

test("the draft never prints a database/schema name or connection details", () => {
  assert.doesNotMatch(
    code,
    /current_database|current_schema|conninfo|rolpassword|password|dsn|postgresql:\/\/|host\b|inet_server/i,
    "no connection metadata in the operator's output",
  );
  assert.match(code, /finance_object_count/);
  assert.match(code, /owned_by_neondb_owner/);
  assert.match(code, /public_relation_count/);
});

test("the step checklist keeps every approval gate intact", () => {
  assert.match(md, /موافقة SQL صريحة منفصلة/);
  assert.match(md, /موافقة نشر منفصلة/);
  assert.match(md, /خطة رجوع/);
  assert.match(md, /لا تضغط `Sync`/);
  assert.match(md, /المالية غير جاهزة للنشر|ما زالت غير جاهزة للنشر/);
  assert.match(md, /IDENTITY_GAP_CONFIRMED/);
});

test("the chat-delivered draft still demands its own explicit approval phrase", () => {
  assert.match(md, /راجعتُ نص الجرد وأُجيز تشغيله قراءةً فقط/);
  assert.match(sql, /DRAFT \/ NOT AUTHORIZED FOR EXECUTION/);
  assert.match(md, /لا تُلصق هذا النص في SQL Editor قبل الخطوة ٩/);
  assert.match(md, /بلا اسم قاعدة ولا رابط اتصال/);
  assert.match(log, /## ٣٤\./);
  const [, block] = [0, md.split("```sql\n")[1].split("\n```")[0]];
  assert.match(block, /^\s*BEGIN TRANSACTION READ ONLY;/m);
  assert.match(block, /^\s*ROLLBACK;\s*$/m);
  assert.equal((block.match(/^\s*SELECT/mg) || []).length, 5, "exactly five SELECTs in the chat-pasteable draft");
});

test("the supplementary public inventory draft is read-only and still gated", () => {
  const draft = readFileSync(path.join(process.cwd(), "prototypes/finance-app-identity/public-inventory-DRAFT-NOT-EXECUTABLE.md"), "utf8");
  assert.match(draft, /DRAFT|غير مُجاز للتنفيذ/);
  assert.match(draft, /راجعتُ نص جرد `public` التكميلي وأُجيز تشغيله قراءةً فقط/);
  const sql = draft.split("```sql\n")[1].split("\n```")[0];
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.match(code, /^\s*BEGIN TRANSACTION READ ONLY;/m);
  assert.match(code, /SET LOCAL statement_timeout\s*=\s*'15s';/);
  assert.match(code, /^\s*ROLLBACK;\s*$/m);
  assert.equal((sql.match(/^\s*SELECT/mg) || []).length, 4, "exactly four SELECT statements");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|REASSIGN|VACUUM|REINDEX|SET\s+ROLE)\b/i, "no write or DCL in the new draft");
  assert.doesNotMatch(code, /current_database|current_schema|conninfo|rolpassword|password|dsn|postgresql:\/\/|host\b|inet_server/i, "no connection metadata");
  assert.match(code, /relkind IN \('r','p','v','m','S'\)/);
  assert.match(code, /relforcerowsecurity/);
  assert.match(code, /public_user_trigger_count/);
  assert.match(draft, /public_relation_count=63/);
  assert.match(draft, /ليست.*موافقة SQL|ليست موافقة SQL/);
});

test("the phase-4 review draft is deliberately non-executable and rollback-ending", () => {
  const draft = readFileSync(path.join(process.cwd(), "prototypes/finance-app-identity/phase4-sql-REVIEW-DRAFT-NOT-EXECUTABLE.md"), "utf8");
  assert.match(draft, /لا تُلصق أي سطر/);
  assert.match(draft, /DRAFT \/ NOT AUTHORIZED FOR EXECUTION/);
  const sql = draft.split("```sql\n")[1].split("\n```")[0];
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^ROLLBACK;$/m, "the draft must never end in COMMIT");
  assert.doesNotMatch(sql, /^\s*COMMIT;/m);
  // every executable-looking line is a comment carrying a placeholder
  const executable = sql.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("--") && !l.startsWith("ملاحظة"));
  assert.deepEqual(executable, ["BEGIN;", "SET LOCAL statement_timeout = '60s';", "ROLLBACK;"]);
  assert.match(sql, /<FINANCE_APP_ROLE>/);
  assert.match(sql, /<FINANCE_ADMIN_ROLE>/);
  assert.match(sql, /<MANAGED_EXTERNALLY>/);
  assert.doesNotMatch(draft, /postgresql:\/\/|CREATE ROLE \w+ LOGIN PASSWORD '[A-Za-z0-9]/);
  assert.match(draft, /لا REASSIGN OWNED شامل/);
  assert.match(draft, /موافقة SQL صريحة منفصلة/);
  assert.match(draft, /موافقة نشر منفصلة/);
  assert.match(draft, /public.expense_categories/);
  assert.match(draft, /NOT_READY/);
});

test("the final phase-4 review text rejects Console roles and stays non-executable", () => {
  const final = readFileSync(path.join(process.cwd(), "prototypes/finance-app-identity/phase4-sql-FINAL-FOR-REVIEW-NOT-EXECUTED.md"), "utf8");
  assert.match(final, /Neon Console ← Add role/);
  assert.match(final, /neon_superuser/);
  assert.match(final, /BYPASSRLS/);
  assert.match(final, /توصية شفهية سابقة بـ«Console» \*\*خاطئة\*\*/);
  assert.match(final, /selahtone_app/);
  assert.match(final, /selahtone_finance_admin/);
  assert.match(final, /PG_|pg_/i);
  assert.match(final, /token_roles/, "reserved names listed");
  const sql = final.split("```sql\n")[1].split("\n```")[0];
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^ROLLBACK;/m);
  assert.doesNotMatch(sql, /^\s*COMMIT;/m, "review copy must never commit");
  assert.match(sql, /<GENERATED_LOCALLY>/, "password placeholder keeps it unexecutable");
  assert.doesNotMatch(final, /npg_[A-Za-z0-9]{8,}|T3sting!23Ab|password'\s*=\s*'[^<]/);
  assert.match(sql, /CREATE ROLE selahtone_app WITH LOGIN PASSWORD '<GENERATED_LOCALLY>'/);
  assert.match(sql, /CREATE ROLE selahtone_finance_admin NOLOGIN/);
  assert.equal((sql.match(/^ALTER TABLE finance\./gm) || []).length, 18, "all 18 tables");
  // IDENTITY sequences follow the table owner; explicit ALTER SEQUENCE was lab-proven to fail
  assert.doesNotMatch(sql, /^ALTER SEQUENCE finance\./m, "no ALTER SEQUENCE on linked identity sequences");
  assert.match(sql, /GRANT selahtone_finance_admin TO neondb_owner;/);
  assert.match(sql, /GRANT CREATE ON SCHEMA finance TO selahtone_finance_admin;/);
  assert.match(sql, /REVOKE CREATE ON SCHEMA finance FROM selahtone_finance_admin;/);
  assert.match(sql, /has_database_privilege\('selahtone_app', current_database\(\), 'CONNECT'\)/);
  assert.match(sql, /cannot change owner of sequence/);
  assert.doesNotMatch(sql, /^\s*COMMIT;/m);
  const executable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(executable, /GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA finance/);
  assert.doesNotMatch(executable, /DELETE ON ALL TABLES IN SCHEMA finance|TRUNCATE|REASSIGN OWNED/);
  assert.match(sql, /has_table_privilege\('selahtone_app', 'finance.expenses', 'DELETE'\)/);
  assert.match(final, /موافقة SQL صريحة منفصلة/);
  assert.match(final, /موافقة نشر منفصلة/);
});

test("the PG18 lab finding is recorded before the SQL is sent to chat", () => {
  const final = readFileSync(path.join(process.cwd(), "prototypes/finance-app-identity/phase4-sql-FINAL-FOR-REVIEW-NOT-EXECUTED.md"), "utf8");
  assert.match(final, /## ١أ\. تصحيح تقني مُتحقَّق مخبريًا/);
  assert.match(final, /must be able to SET ROLE/);
  assert.match(final, /permission denied for schema finance/);
  assert.match(final, /cannot change owner of sequence/);
  assert.match(final, /GENERATED ALWAYS AS IDENTITY/);
  assert.match(final, /الشرطان لازمان معًا/);
  assert.match(readFileSync(path.join(process.cwd(), "docs/finance-release-log.md"), "utf8"), /## ٤٢\./);
  // the chat copy is still a review copy, never an approved executable batch
  assert.match(final, /^ROLLBACK;/m);
  assert.match(final, /<GENERATED_LOCALLY>/);
  assert.match(final, /موافقة SQL صريحة منفصلة/);
});

test("the approved executable copy differs from the reviewed text only by the final line", () => {
  const root = path.join(process.cwd(), "prototypes/finance-app-identity");
  const review = readFileSync(path.join(root, "phase4-sql-FINAL-FOR-REVIEW-NOT-EXECUTED.md"), "utf8");
  const exec = readFileSync(path.join(root, "phase4-sql-EXECUTABLE-APPROVED.md"), "utf8");
  const rblock = review.split("```sql\n")[1].split("\n```")[0];
  const eblock = exec.split("```sql\n")[1].split("\n```")[0];
  const rlines = rblock.split("\n");
  const elines = eblock.split("\n");
  assert.match(rlines[rlines.length - 1], /^ROLLBACK;/);
  assert.match(rlines[0], /NOT EXECUTED/);
  assert.match(elines[0], /APPROVED 2026-11-05/);
  // only the first comment and the final terminator differ; all executable lines are identical
  const rmid = rlines.slice(1, -1).join("\n").trimEnd();
  const emid = elines.slice(1).join("\n").trimEnd();
  assert.equal(emid, rmid);
  assert.doesNotMatch(eblock, /^\s*(COMMIT|ROLLBACK);/m, "no transaction terminator inside the batch");
  assert.match(exec, /```sql\nCOMMIT;\n```/);
  assert.match(exec, /```sql\nROLLBACK;\n```/);
  assert.match(exec, /الصقها كاملة.*Run مرة واحدة/);
  assert.match(exec, /<GENERATED_LOCALLY>/);
  assert.match(exec, /موافقة نشر منفصلة/);
  assert.doesNotMatch(exec, /postgresql:\/\//);
  assert.equal((eblock.match(/^ALTER TABLE finance\./gm) || []).length, 18);
  assert.doesNotMatch(eblock, /^ALTER SEQUENCE finance\./m);
  assert.match(readFileSync(path.join(process.cwd(), "docs/finance-release-log.md"), "utf8"), /## ٤٣\./);
});
