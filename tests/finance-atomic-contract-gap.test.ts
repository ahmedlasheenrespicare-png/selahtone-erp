/**
 * TEST ONLY. Demonstrates the central gap of the "atomic cash contract":
 *
 *   The HTTP layer decides access BEFORE the SERIALIZABLE finance transaction
 *   starts (requireSession → writeAccessAllowed → engine). A concurrent
 *   revocation of the access_control row after that decision does not stop the
 *   already-decided write, because the rule is never re-read under the actor
 *   lock inside the transaction. The same applies to a revoked auth session:
 *   the session row is checked when acquired, not continuously until COMMIT.
 *
 * Nothing here changes production code. This is a laboratory reproduction on a
 * disposable PGlite database with fake users, fake rules and fake cash rows.
 * It proves a gap, not a fix; it does not prove money moved or a human reviewed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

/** Minimal shape of the real access_control table and the session guard. */
async function fixture(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE public.users(id bigint PRIMARY KEY, role_code text, status text, must_change_password boolean, email text);
    CREATE TABLE public.auth_sessions(id text PRIMARY KEY, user_id bigint, expires_at timestamptz);
    CREATE TABLE public.access_control(subject_kind text, subject text, key text, allowed boolean);
    CREATE TABLE public.commerce_collections(id bigint PRIMARY KEY, amount numeric, request_id uuid);
    CREATE TABLE finance_ledger(id bigint PRIMARY KEY, collection_id bigint, amount numeric,
      CONSTRAINT ledger_matches_collection CHECK (collection_id = id));
    INSERT INTO public.users VALUES(3,'CS_AGENT','ACTIVE',false,'staff@example.test');
    INSERT INTO public.auth_sessions VALUES('sess-1',3, now() + interval '1 hour');
    INSERT INTO public.access_control VALUES('role','CS_AGENT','finance.write',true);
  `);
}

/** What the HTTP layer does today: decide from access_control OUTSIDE the tx. */
async function decideOutsideTransaction(pg: PGlite, key: string): Promise<boolean> {
  const rows = await pg.query<{ allowed: boolean }>(
    "SELECT allowed FROM public.access_control WHERE subject_kind='role' AND subject='CS_AGENT' AND key=$1", [key]);
  return rows.rows[0]?.allowed === true;
}

/** What the engine does today: re-read the actor and session under locks, but
 *  NOT the access_control rule; then write both rows in one unit. */
async function decidedWrite(pg: PGlite, id: string): Promise<void> {
  await pg.exec("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const actor = await pg.query<{ status: string }>("SELECT status FROM public.users WHERE id=3 FOR SHARE");
    assert.equal(actor.rows[0]?.status, "ACTIVE");
    const session = await pg.query<{ valid: boolean }>(
      "SELECT expires_at > clock_timestamp() AS valid FROM public.auth_sessions WHERE id='sess-1' AND user_id=3 FOR SHARE");
    assert.equal(session.rows[0]?.valid, true);
    // NOTE: no read of public.access_control here — the decision was made above.
    await pg.query("INSERT INTO public.commerce_collections VALUES($1, 10, gen_random_uuid())", [id]);
    await pg.query("INSERT INTO finance_ledger VALUES($1, $1, 10)", [id]);
    await pg.exec("COMMIT");
  } catch (error) { await pg.exec("ROLLBACK"); throw error; }
}

test("a permission revoked after the HTTP decision does not stop the cash write", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    assert.equal(await decideOutsideTransaction(pg, "finance.write"), true, "decision allows the write");
    // Simulate an administrator revoking the rule between decision and commit.
    await pg.exec("UPDATE public.access_control SET allowed=false WHERE key='finance.write';");
    await decidedWrite(pg, "101");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.commerce_collections")).rows[0].n, 1);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance_ledger")).rows[0].n, 1);
    assert.equal(await decideOutsideTransaction(pg, "finance.write"), false, "rule is now revoked");
    // The gap: the write stands even though the rule under which it was allowed no longer holds.
  } finally { await pg.close(); }
});

test("expiry is checked when the session row is acquired, not continuously until COMMIT", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    assert.equal(await decideOutsideTransaction(pg, "finance.write"), true);
    await pg.exec("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const session = await pg.query<{ valid: boolean }>(
      "SELECT expires_at > clock_timestamp() AS valid FROM public.auth_sessions WHERE id='sess-1' AND user_id=3 FOR SHARE");
    assert.equal(session.rows[0]?.valid, true, "checked when the row was acquired");
    // The same transaction may expire the session after the check; the guard is
    // not repeated at COMMIT, so both cash rows still commit. This is the gap
    // documented in src/lib/finance/session-transaction.ts, reproduced honestly.
    await pg.query("UPDATE public.auth_sessions SET expires_at = now() - interval '1 minute' WHERE id='sess-1'");
    await pg.query("INSERT INTO public.commerce_collections VALUES(102, 10, gen_random_uuid())");
    await pg.query("INSERT INTO finance_ledger VALUES(102, 102, 10)");
    await pg.exec("COMMIT");
    assert.equal((await pg.query<{ valid: boolean }>(
      "SELECT expires_at > clock_timestamp() AS valid FROM public.auth_sessions WHERE id='sess-1'")).rows[0]?.valid, false);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance_ledger")).rows[0].n, 1,
      "the write stands although the session is expired at COMMIT time");
  } finally { await pg.close(); }
});

test("re-reading the rule inside the transaction under the actor lock WOULD refuse", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    await pg.exec("UPDATE public.access_control SET allowed=false WHERE key='finance.write';");
    await pg.exec("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const actor = await pg.query<{ status: string }>("SELECT status FROM public.users WHERE id=3 FOR SHARE");
    assert.equal(actor.rows[0]?.status, "ACTIVE");
    const rule = await pg.query<{ allowed: boolean }>(
      "SELECT allowed FROM public.access_control WHERE key='finance.write' FOR SHARE");
    assert.equal(rule.rows[0]?.allowed, false, "the proposed contract re-reads the rule in-transaction");
    await pg.exec("ROLLBACK");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.commerce_collections")).rows[0].n, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance_ledger")).rows[0].n, 0);
  } finally { await pg.close(); }
});

test("the two written rows ARE atomic together, but the access decision is outside that unit", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    await pg.exec("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await pg.query("INSERT INTO public.commerce_collections VALUES(201, 10, gen_random_uuid())");
    // A real constraint violation: the ledger row must point at its own id.
    await assert.rejects(() => pg.query("INSERT INTO finance_ledger VALUES(201, 999, 10)"), /constraint|check/i);
    await pg.exec("ROLLBACK");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.commerce_collections")).rows[0].n, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance_ledger")).rows[0].n, 0);
    // Atomicity of the WRITTEN rows is real; what is missing is bringing the
    // access-control and session decisions into the same transaction boundary.
  } finally { await pg.close(); }
});
