/** Synthetic database only: CLI delegates to the shared transactional guard. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { readDirectoryFinanceAccounts, setDirectoryBranchActive, setDirectoryUserStatus, updateDirectoryUser } from "../src/lib/admin-directory-operations";
import { closeAccount, openAccount } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import type { FinanceDatabase } from "../src/lib/finance/types";

const root = process.cwd(), read = (f: string) => readFileSync(join(root,f), "utf8");
const require = createRequire(join(root, "package.json"));
const { PrismaClient: WasmClient } = require("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };
function failureClient(db: PrismaClient, match: string): PrismaClient {
  return new Proxy(db, { get(target,key,receiver) {
    if (key !== "$transaction") return Reflect.get(target,key,receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => work(new Proxy(tx, { get(obj,prop,recv) {
      if (prop !== "$queryRawUnsafe") return Reflect.get(obj,prop,recv);
      return (sql: string, ...params: unknown[]) => {
        if (sql.includes(match)) throw Object.assign(new Error("synthetic inaccessible table"), { code: "42501" });
        return tx.$queryRawUnsafe(sql, ...params);
      };
    } })), options as never);
  } }) as PrismaClient;
}

test("status command uses shared custody guard and fails closed without losing sessions", { timeout: 120_000 }, async () => {
  const script = read("scripts/set-user-status.ts");
  assert.match(script, /setDirectoryUserStatus\(prisma, email\.data, status, process\.env\.FINANCE_ENABLED === "true"\)/);
  assert.doesNotMatch(script, /prisma\.user\.update|prisma\.authSession\.deleteMany/);
  const dir = mkdtempSync(join(tmpdir(), "selahtone-status-guard-"));
  let pg: PGlite | undefined, client: PrismaClient | undefined;
  try {
    execFileSync(process.execPath, [join(root,"scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Test-2026!" }, stdio: "pipe", timeout: 60000 });
    pg = new PGlite(dir); client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const email = "arh@selahtone.local";
    const status = async () => (await client!.user.findUniqueOrThrow({ where: { email } })).status;
    const sessions = async () => client!.authSession.count({ where: { userId: 3n } });
    const addSession = async () => client!.authSession.create({ data: { id: randomUUID(), userId: 3n, expiresAt: new Date(Date.now()+3_600_000) } });
    await addSession();
    const expected = async () => client!.user.findUniqueOrThrow({ where: { id: 3n }, select: { fullName: true, email: true, phone: true, roleCode: true, branchId: true, status: true } });
    const updateUser = async (branchId: bigint | null, status: "ACTIVE" | "SUSPENDED") => {
      const old = await expected();
      return { userId: 3n, actorRole: "MANAGER" as const, financeOn: false, expected: old, data: { ...old, branchId, status } };
    };
    const branchActive = async () => (await client!.branch.findUniqueOrThrow({ where: { id: 2n } })).isActive;
    const warehouseActive = async () => (await client!.warehouse.findUniqueOrThrow({ where: { id: 2n } })).isActive;
    assert.equal((await readDirectoryFinanceAccounts(client, false)).state, "absent");
    assert.equal((await readDirectoryFinanceAccounts(client, true)).state, "unavailable");
    await setDirectoryBranchActive(client, 2n, false, false);
    assert.equal(await branchActive(), false); assert.equal(await warehouseActive(), false);
    await setDirectoryBranchActive(client, 2n, true, false);
    // Explicitly enabled but absent schema: cannot silently suspend.
    await assert.rejects(() => setDirectoryUserStatus(client!, email, "SUSPENDED", true), /تعذّر التحقق من العهد/);
    assert.equal(await status(), "ACTIVE"); assert.equal(await sessions(), 1);
    // A partially installed schema is not evidence that it is safe to skip.
    await pg.exec("CREATE SCHEMA finance");
    await assert.rejects(() => setDirectoryUserStatus(client!, email, "SUSPENDED", false), /مخطط المالية غير مكتمل/);
    await assert.rejects(async () => updateDirectoryUser(client!, await updateUser(2n, "ACTIVE")), /مخطط المالية غير مكتمل/);
    await assert.rejects(() => setDirectoryBranchActive(client!, 2n, false, false), /مخطط المالية غير مكتمل/);
    assert.equal((await readDirectoryFinanceAccounts(client, false)).state, "unavailable");
    assert.equal(await branchActive(), true); assert.equal(await warehouseActive(), true);
    assert.equal((await expected()).branchId, 1n);
    assert.equal(await status(), "ACTIVE"); assert.equal(await sessions(), 1);
    await pg.exec("DROP SCHEMA finance");
    // Finance absent and disabled: no account table can hold an open custody.
    await setDirectoryUserStatus(client, email, "SUSPENDED", false);
    assert.equal(await status(), "SUSPENDED"); assert.equal(await sessions(), 0);
    await addSession();
    await setDirectoryUserStatus(client, email, "ACTIVE", false);
    assert.equal(await status(), "ACTIVE"); assert.equal(await sessions(), 0, "reactivation also revokes sessions");
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql"]) await pg.exec(read(f));
    const db: FinanceDatabase = { serializable: work => client!.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    const custody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: today, counted: true }, today);
    // A legacy-style suspended holder with open custody in another branch.
    await pg.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 4,2,role_code,'موظف اصطناعي موقوف','synthetic-disabled-holder@selahtone.local',password_hash,'SUSPENDED',false,'FULL',false,now() FROM users WHERE id=3;
      INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES(2,'CUSTODY',4,0,CURRENT_DATE,1)`);
    const otherCustody = (await pg.query<{ id: string }>("SELECT id::text FROM finance.accounts WHERE holder_id=4")).rows[0].id;
    const summary = await readDirectoryFinanceAccounts(client, false);
    assert.equal(summary.state, "ready"); assert.deepEqual(summary.rows.map(row => row.holderId).sort(), ["3","4"]);
    await addSession();
    // Even without the environment flag the CLI sees the installed schema.
    await assert.rejects(() => setDirectoryUserStatus(client!, email, "SUSPENDED", false), /عهدة نقدية مفتوحة/);
    await assert.rejects(() => setDirectoryUserStatus(client!, email, "SUSPENDED", true), /عهدة نقدية مفتوحة/);
    await assert.rejects(() => setDirectoryUserStatus(failureClient(client!, "FROM finance.accounts"), email, "SUSPENDED", false), /تعذّر التحقق من العهد/);
    await assert.rejects(() => setDirectoryUserStatus(failureClient(client!, "to_regclass('finance.accounts')"), email, "SUSPENDED", false), /تعذّر التحقق من جاهزية المالية/);
    await assert.rejects(async () => updateDirectoryUser(client!, await updateUser(2n, "ACTIVE")), /عهدة نقدية مفتوحة/);
    await assert.rejects(async () => updateDirectoryUser(client!, await updateUser(1n, "SUSPENDED")), /عهدة نقدية مفتوحة/);
    await assert.rejects(async () => updateDirectoryUser(failureClient(client!, "FROM finance.accounts"), await updateUser(2n, "ACTIVE")), /تعذّر التحقق من العهد/);
    await assert.rejects(() => setDirectoryBranchActive(client!, 2n, false, false), /عهدة نقدية مفتوحة/);
    await assert.rejects(() => setDirectoryBranchActive(failureClient(client!, "FROM finance.accounts"), 2n, false, false), /تعذّر التحقق من العهد/);
    await assert.rejects(() => setDirectoryBranchActive(failureClient(client!, "to_regclass('finance.accounts')"), 2n, false, false), /تعذّر التحقق من جاهزية المالية/);
    assert.equal((await readDirectoryFinanceAccounts(failureClient(client!, "FROM finance.accounts"), false)).state, "unavailable");
    assert.equal(await branchActive(), true); assert.equal(await warehouseActive(), true);
    assert.equal((await expected()).branchId, 1n);
    assert.equal(await status(), "ACTIVE"); assert.equal(await sessions(), 1);
    // Closing the fixture custody restores the permitted directory operations.
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: otherCustody, reason: "إغلاق اصطناعي" });
    await setDirectoryBranchActive(client, 2n, false, false);
    assert.equal(await branchActive(), false); assert.equal(await warehouseActive(), false);
    await setDirectoryBranchActive(client, 2n, true, false);
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: custody.id, reason: "إغلاق اصطناعي" });
    await updateDirectoryUser(client, await updateUser(2n, "ACTIVE"));
    assert.equal((await expected()).branchId, 2n); assert.equal(await sessions(), 1);
    await updateDirectoryUser(client, await updateUser(2n, "SUSPENDED"));
    assert.equal(await status(), "SUSPENDED"); assert.equal(await sessions(), 0);
    await assert.rejects(() => setDirectoryUserStatus(client!, "absent@selahtone.local", "SUSPENDED", false), /المستخدم غير موجود/);
  } finally {
    if (client) await client.$disconnect(); else if (pg) await pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
