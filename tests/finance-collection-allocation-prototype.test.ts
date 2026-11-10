/** Disposable transactional experiment; does not exercise real app writes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { allocateTestCollection, assertTestNoPendingCollections, attachTestCollectionsToSettlement, pendingTestCollections } from "../prototypes/finance-collection-policy/allocate.test-only";
import { recordVaultCollectionTestOnly, recordCustodyCollectionTestOnly } from "../prototypes/finance-collection-policy/vault-collection-command.test-only";
import { vaultReceiptIdentityTestOnly } from "../prototypes/finance-collection-policy/vault-receipt-identity.test-only";
import { parseMoneyMovement } from "../src/lib/commerce-validation";
import { openAccount, listAccounts, requestCashCount, confirmCashCount, cancelCashCount, requestSettlement, cancelSettlement } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import { FinanceProblem, type FinanceDatabase } from "../src/lib/finance/types";
const root = process.cwd();
const { PrismaClient: WasmClient } = createRequire(join(root, "package.json"))("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };

test("prototype records exact collection assignments atomically; custody pending vs vault movement", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-allocation-prototype-")); let pg: PGlite | undefined; let client: PrismaClient | undefined;
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Access-Test-2026!" }, stdio: "pipe", timeout: 60_000 });
    pg = new PGlite(dir); await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(readFileSync(join(root, f), "utf8"));
    const candidate = readFileSync(join(root, "prototypes/finance-collection-policy/allocations.test-only.sql"), "utf8");
    await assert.rejects(() => pg!.exec(candidate), /explicit disposable database opt-in/);
    await pg.exec("SET selahtone.collection_policy_test_only='yes'"); await pg.exec(candidate);
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: (work) => client!.$transaction((tx) => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    const open = (kind: "VAULT" | "CUSTODY", holderId: string | null) => openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind, holderId, openingAmount: "0", openingDate: today, counted: true }, today);
    const vault = (await open("VAULT", null)).id; const custody = (await open("CUSTODY", "3")).id;
    const count = async (table: "collections" | "allocations" | "movements") => Number((await pg!.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table === "collections" ? "public.commerce_collections" : table === "allocations" ? "finance.collection_allocations_test_only" : "finance.movements"}`)).rows[0].n);
    const initialCount = await count("collections");
    const record = async (actor: bigint, amount: string, method = "CASH", abort = false, vaultReceived = true) => client!.$transaction(async (tx) => {
      const created = await tx.commerceCollection.create({ data: { requestId: randomUUID(), requestHash: "a".repeat(64), saleId: 2n, amount, method, isInitial: false, createdById: actor } });
      const result = await allocateTestCollection(financePort(tx), actor.toString(), created.id.toString(), { vaultReceived });
      const replay = await allocateTestCollection(financePort(tx), actor.toString(), created.id.toString());
      assert.equal(replay.replayed, true); assert.equal(replay.accountId, result.accountId);
      if (abort) throw new Error("synthetic rollback");
      return { ...result, collectionId: created.id.toString() };
    }, { isolationLevel: "Serializable", timeout: 20000 });
    const staffResult = await record(3n, "37");
    assert.equal(staffResult.accountId, custody); assert.equal(staffResult.treatment, "CUSTODY_PENDING");
    assert.equal(await db.serializable((tx) => pendingTestCollections(tx, custody)), "37.00");
    await assert.rejects(() => db.serializable((tx) => assertTestNoPendingCollections(tx, custody)), (e: unknown) => e instanceof FinanceProblem && e.code === "pending_collections");
    await assert.rejects(() => record(1n, "19", "CASH", false, false), (e: unknown) => e instanceof FinanceProblem && e.code === "vault_receipt_required");
    assert.equal(await count("collections"), initialCount + 1, "missing vault attestation rolls back the source collection");
    assert.equal(await count("movements"), 0);
    const managerResult = await record(1n, "19");
    assert.equal(managerResult.accountId, vault); assert.equal(managerResult.treatment, "VAULT_MOVEMENT");
    const attestation = await pg.query<{attested:boolean;movement:string}>("SELECT vault_received_attested AS attested,movement_id::text AS movement FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint", [managerResult.collectionId]);
    assert.equal(attestation.rows[0].attested, true);
    assert.ok(attestation.rows[0].movement, "one synthetic movement is linked to the attested collection");
    const vaultMovement = await pg.query<{kind:string;amount:string;destination:string;external:string}>("SELECT kind,amount::text AS amount,destination_id::text AS destination,external_ref AS external FROM finance.movements WHERE id=$1::bigint", [attestation.rows[0].movement]);
    assert.deepEqual(vaultMovement.rows[0], {kind:"COLLECTION",amount:"19.00",destination:vault,external:`collection:${managerResult.collectionId}`});
    for (const bad of [null, false]) {
      await assert.rejects(() => pg!.query("UPDATE finance.collection_allocations_test_only SET vault_received_attested=$2::boolean WHERE collection_id=$1::bigint", [managerResult.collectionId,bad]), /check constraint/i);
    }
    assert.equal((await pg.query<{attested:boolean}>("SELECT vault_received_attested AS attested FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint", [managerResult.collectionId])).rows[0].attested, true);
    assert.equal(await count("allocations"), 2); assert.equal(await count("movements"), 1);
    assert.equal((await listAccounts(db, "1")).find((row) => row.id === vault)?.balance, "19.00");
    assert.equal((await listAccounts(db, "1")).find((row) => row.id === custody)?.balance, "0.00");
    // This isolated command tests the new request identity and attestation
    // together. All its synthetic writes are intentionally rolled back.
    const beforeCommand = { collections: await count("collections"), allocations: await count("allocations"), movements: await count("movements"), vault: (await listAccounts(db, "1")).find(row => row.id === vault)?.balance };
    let probeReached = false;
    await assert.rejects(() => db.serializable(async tx => {
      const legacyInput = { requestId: randomUUID(), saleId: "2", amount: "6", method: "CASH", actuallyPaid: false };
      const parsed = parseMoneyMovement(legacyInput, false); assert.ok(parsed.ok);
      const legacyIdentity = vaultReceiptIdentityTestOnly(1n, parsed.value, legacyInput);
      const legacy = await tx.query<{id:string}>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
        VALUES($1::uuid,$2,2,6,'CASH',false,1) RETURNING id::text`, [legacyInput.requestId,legacyIdentity.baseHash]);
      assert.deepEqual(await recordVaultCollectionTestOnly(tx,1n,legacyInput),{id:legacy.rows[0].id,replayed:true});
      assert.equal((await tx.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint", [legacy.rows[0].id])).rows[0].n,0, "legacy replay invents neither an allocation nor an attestation");
      await assert.rejects(() => recordVaultCollectionTestOnly(tx,1n,{...legacyInput,vaultReceived:true}), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
      const noReceipt = { ...legacyInput, requestId: randomUUID() };
      await assert.rejects(() => recordVaultCollectionTestOnly(tx,1n,noReceipt), (e: unknown) => e instanceof FinanceProblem && e.code === "vault_receipt_required");
      const submitted = { ...noReceipt, vaultReceived: true };
      const created = await recordVaultCollectionTestOnly(tx,1n,submitted);
      assert.equal(created.replayed,false);
      assert.deepEqual(await recordVaultCollectionTestOnly(tx,1n,submitted),{id:created.id,replayed:true});
      await tx.query("UPDATE users SET status='SUSPENDED' WHERE id=1");
      await assert.rejects(() => recordVaultCollectionTestOnly(tx,1n,submitted), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden", "replay still checks current commerce authorization");
      await tx.query("UPDATE users SET status='ACTIVE' WHERE id=1");
      await assert.rejects(() => recordVaultCollectionTestOnly(tx,1n,noReceipt), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
      await assert.rejects(() => recordVaultCollectionTestOnly(tx,1n,{...submitted,amount:"7"}), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
      const evidence = await tx.query<{n:number;attested:boolean}>(`SELECT (SELECT count(*)::int FROM finance.movements WHERE external_ref=$2) AS n,vault_received_attested AS attested FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint`, [created.id,`collection:${created.id}`]);
      assert.deepEqual(evidence.rows[0],{n:1,attested:true});
      probeReached = true;
      throw new Error("vault command probe rollback");
    }), /vault command probe rollback/);
    assert.ok(probeReached);
    assert.deepEqual({ collections: await count("collections"), allocations: await count("allocations"), movements: await count("movements"), vault: (await listAccounts(db, "1")).find(row => row.id === vault)?.balance }, beforeCommand);
    // Replay is an identity lookup, not a new destination decision: even if
    // the recorder subsequently gains custody, it must preserve the original
    // attested vault allocation. Roll the whole disposable probe back.
    let destinationReplayReached = false;
    await assert.rejects(() => db.serializable(async tx => {
      await tx.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 991,1,role_code,'اختبار تغير الوجهة','destination-replay-test@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
      const input = {requestId:randomUUID(),saleId:"2",amount:"5",method:"CASH",actuallyPaid:false,vaultReceived:true};
      const saved = await recordVaultCollectionTestOnly(tx,991n,input);
      assert.equal(saved.replayed,false);
      const allocation = await tx.query<{accountId:string;movementId:string;attested:boolean}>(`SELECT account_id::text AS "accountId",movement_id::text AS "movementId",vault_received_attested AS attested FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint`,[saved.id]);
      assert.equal(allocation.rows[0].accountId,vault); assert.ok(allocation.rows[0].movementId); assert.equal(allocation.rows[0].attested,true);
      const newCustody = (await tx.query<{id:string}>(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES(1,'CUSTODY',991,0,CURRENT_DATE,1) RETURNING id::text`)).rows[0].id;
      assert.deepEqual(await recordVaultCollectionTestOnly(tx,991n,input),{id:saved.id,replayed:true});
      const after = await tx.query<{accountId:string;movementId:string;attested:boolean}>(`SELECT account_id::text AS "accountId",movement_id::text AS "movementId",vault_received_attested AS attested FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint`,[saved.id]);
      assert.deepEqual(after.rows,allocation.rows);
      assert.equal((await tx.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1",[`collection:${saved.id}`])).rows[0].n,1);
      assert.equal(await pendingTestCollections(tx,newCustody),"0.00");
      destinationReplayReached = true;
      throw new Error("destination replay probe rollback");
    }),/destination replay probe rollback/);
    assert.ok(destinationReplayReached);
    assert.deepEqual({collections:await count("collections"),allocations:await count("allocations"),movements:await count("movements"),vault:(await listAccounts(db,"1")).find(row => row.id === vault)?.balance},beforeCommand);
    // A recorder with a custody must not be silently rerouted to the vault by
    // this vault-only command. Its attempted pending allocation and all prior
    // invoice/source writes must roll back with the transaction.
    await pg.exec(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 990,1,role_code,'مدير عهدة اصطناعي','custody-manager-test@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
    const managerCustody = (await pg.query<{id:string}>(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
      VALUES(1,'CUSTODY',990,0,CURRENT_DATE,1) RETURNING id::text`)).rows[0].id;
    for (const [actor,account] of [[3n,custody],[990n,managerCustody]] as const) {
      const input = {requestId:randomUUID(),saleId:"2",amount:"5",method:"CASH",actuallyPaid:false,vaultReceived:true};
      const before: {saleRevision:string;accountRevision:string;collections:number;allocations:number;movements:number} = (await pg.query<{saleRevision:string;accountRevision:string;collections:number;allocations:number;movements:number}>(`SELECT
        (SELECT revision::text FROM commerce_sales WHERE id=2) AS "saleRevision",
        (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS "accountRevision",
        (SELECT count(*)::int FROM commerce_collections) AS collections,
        (SELECT count(*)::int FROM finance.collection_allocations_test_only) AS allocations,
        (SELECT count(*)::int FROM finance.movements) AS movements`,[account])).rows[0];
      await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,actor,input)),
        (e: unknown) => e instanceof FinanceProblem && e.code === "not_vault_destination");
      const after: {saleRevision:string;accountRevision:string;collections:number;allocations:number;movements:number} = (await pg.query<typeof before>(`SELECT
        (SELECT revision::text FROM commerce_sales WHERE id=2) AS "saleRevision",
        (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS "accountRevision",
        (SELECT count(*)::int FROM commerce_collections) AS collections,
        (SELECT count(*)::int FROM finance.collection_allocations_test_only) AS allocations,
        (SELECT count(*)::int FROM finance.movements) AS movements`,[account])).rows[0];
      assert.deepEqual(after,before,"failed vault-only command rolls back all tentative effects");
      assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
    }
    assert.equal(await db.serializable(tx => pendingTestCollections(tx,managerCustody)),"0.00");
    const revision = async () => (await pg!.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [custody])).rows[0].revision;
    assert.equal(await revision(), "1", "custody allocation advances the count checkpoint revision once");
    assert.equal(await db.serializable((tx) => pendingTestCollections(tx, custody)), "37.00", "vault collection must not be counted in custody");
    await assert.rejects(() => record(1n, "8", "CASH", true), /synthetic rollback/);
    await assert.rejects(() => record(1n, "8", "CARD"), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_collection");
    assert.equal(await count("collections"), initialCount + 2); assert.equal(await count("allocations"), 2); assert.equal(await count("movements"), 1);
    // Simulate only the final state transition, not the real settlement engine:
    // a future integration must run this hook in the real confirmation transaction.
    const settlement = (await pg.query<{ id: number }>(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES ($1::bigint,1,3,0,37,37,0,37,0,37,'تسوية اصطناعية') RETURNING id`, [custody])).rows[0].id.toString();
    async function confirm(items: string[], overrideTotal?: string, abort = false) {
      return db.serializable(async (tx) => {
        await tx.query(`UPDATE finance.settlements SET status='CONFIRMED',resolved_by=1,resolved_at=now(),resolution_reason='اعتماد اصطناعي',transfer_amount=37,transfer_direction='TO_VAULT',sales_total=COALESCE($2::numeric,sales_total) WHERE id=$1::bigint`, [settlement, overrideTotal ?? null]);
        const result = await attachTestCollectionsToSettlement(tx, settlement, items);
        if (abort) throw new Error("synthetic settlement rollback");
        return result;
      });
    }
    await assert.rejects(() => confirm([staffResult.collectionId, managerResult.collectionId]), (e: unknown) => e instanceof FinanceProblem && e.code === "collection_stale");
    await assert.rejects(() => confirm([staffResult.collectionId], "38"), (e: unknown) => e instanceof FinanceProblem && e.code === "total_mismatch");
    await assert.rejects(() => confirm([staffResult.collectionId], undefined, true), /synthetic settlement rollback/);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [settlement])).rows[0].status, "OPEN");
    assert.equal(await db.serializable((tx) => pendingTestCollections(tx, custody)), "37.00");
    assert.equal((await confirm([staffResult.collectionId])).replayed, false);
    assert.equal(await db.serializable((tx) => pendingTestCollections(tx, custody)), "0.00");
    await db.serializable((tx) => assertTestNoPendingCollections(tx, custody));
    const next = await record(3n, "13");
    assert.equal(await db.serializable((tx) => pendingTestCollections(tx, custody)), "13.00");
    assert.equal((await db.serializable((tx) => attachTestCollectionsToSettlement(tx, settlement, [staffResult.collectionId]))).replayed, true);
    await assert.rejects(() => db.serializable((tx) => attachTestCollectionsToSettlement(tx, settlement, [next.collectionId])), (e: unknown) => e instanceof FinanceProblem && e.code === "settlement_conflict");
    assert.equal(await db.serializable((tx) => pendingTestCollections(tx, custody)), "13.00", "replay must not consume later collections");
    await assert.rejects(() => db.serializable((tx) => assertTestNoPendingCollections(tx, custody)), (e: unknown) => e instanceof FinanceProblem && e.code === "pending_collections");
    // Deliberately bypass the experimental guard to characterize that the actual
    // application closure has not been integrated with the candidate table.
    await pg.exec(`UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE id=${BigInt(custody)}`);
    await assert.rejects(() => record(3n, "8"), (e: unknown) => e instanceof FinanceProblem && e.code === "no_custody");
    assert.equal(await count("collections"), initialCount + 3);
    assert.equal(await db.serializable((tx) => pendingTestCollections(tx, custody)), "13.00", "pending assignment survives synthetic closure");
    const afterCloseReplay = await db.serializable((tx) => allocateTestCollection(tx, "3", staffResult.collectionId));
    assert.equal(afterCloseReplay.replayed, true); assert.equal(afterCloseReplay.accountId, custody);
    assert.equal(await revision(), "2", "allocation replay must not advance revision again");
    await pg.exec("UPDATE users SET branch_id=2 WHERE id=3");
    await assert.rejects(() => db.serializable((tx) => allocateTestCollection(tx, "3", staffResult.collectionId)), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await assert.rejects(() => record(3n, "8"), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=3");
    const vaultCount = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: vault, expectedBalance: "19", countedAmount: "19", reason: "جرد خزنة اصطناعي", actuallyCounted: true }, today);
    await assert.rejects(() => record(1n, "8"), (e: unknown) => e instanceof FinanceProblem && e.code === "vault_count_blocked");
    assert.equal((await db.serializable(tx => allocateTestCollection(tx, "1", managerResult.collectionId))).replayed, true, "existing allocation replays with an open count");
    assert.equal(await count("collections"), initialCount + 3); assert.equal(await count("movements"), 1);
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: vaultCount.id, reason: "إلغاء جرد اصطناعي" });
    await assert.rejects(() => record(1n, "8", "CASH", true), /synthetic rollback/, "cancelling the sole open count removes only that blocker");
    assert.equal(await count("movements"), 1, "the deliberate test failure rolls back the new movement");
    const confirmedVaultCount = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: vault, expectedBalance: "19", countedAmount: "19", reason: "جرد خزنة مؤكد اصطناعي", actuallyCounted: true }, today);
    await confirmCashCount(db, "1", { requestId: randomUUID(), countId: confirmedVaultCount.id, reason: "تأكيد اصطناعي", stillCurrent: true });
    await assert.rejects(() => record(1n, "8"), (e: unknown) => e instanceof FinanceProblem && e.code === "vault_count_blocked");
    assert.equal((await db.serializable(tx => allocateTestCollection(tx, "1", managerResult.collectionId))).replayed, true, "existing allocation replays after confirmed count");
    assert.equal(await count("collections"), initialCount + 3); assert.equal(await count("movements"), 1);
    await pg.exec(`UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE id=${BigInt(vault)}`);
    await assert.rejects(() => record(1n, "8"), (e: unknown) => e instanceof FinanceProblem && e.code === "no_vault");
    assert.equal(await count("collections"), initialCount + 3); assert.equal(await count("movements"), 1);
    // A separate custody-only lab command handles a later collection as a
    // single transaction, without intercepting the application service.
    const custodyInput={requestId:randomUUID(),saleId:"2",amount:"5",method:"CASH",actuallyPaid:false};
    const custodyRevisionBefore=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[managerCustody])).rows[0].revision;
    const custodyMovesBefore=await count("movements");
    const savedCustody=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,custodyInput));
    assert.equal(savedCustody.replayed,false);
    assert.deepEqual(await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,custodyInput)),{id:savedCustody.id,replayed:true});
    assert.equal(await db.serializable(tx=>pendingTestCollections(tx,managerCustody)),"5.00");
    assert.equal(await count("movements"),custodyMovesBefore);
    assert.equal((await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[managerCustody])).rows[0].revision,(BigInt(custodyRevisionBefore)+1n).toString());
    await assert.rejects(()=>db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,{...custodyInput,amount:"6"})),(e:unknown)=>e instanceof FinanceProblem && e.code==="request_conflict");
    await assert.rejects(()=>db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,{...custodyInput,vaultReceived:true})),(e:unknown)=>e instanceof FinanceProblem && e.code==="request_conflict");
    const newWithAttestation={...custodyInput,requestId:randomUUID(),vaultReceived:true};
    await assert.rejects(()=>db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,newWithAttestation)),(e:unknown)=>e instanceof FinanceProblem && e.code==="unexpected_receipt");
    const openCount=await requestCashCount(db,"1",{requestId:randomUUID(),accountId:managerCustody,expectedBalance:"0",countedAmount:"0",reason:"جرد اصطناعي للاختبار",actuallyCounted:true},today);
    const blockedInput={...custodyInput,requestId:randomUUID()};
    const beforeBlocked=(await pg.query<{revision:string;saleRevision:string}>(`SELECT revision::text AS revision,(SELECT revision::text FROM commerce_sales WHERE id=2) AS "saleRevision" FROM finance.accounts WHERE id=$1::bigint`,[managerCustody])).rows[0];
    await assert.rejects(()=>db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,blockedInput)),(e:unknown)=>e instanceof FinanceProblem && e.code==="custody_pending");
    assert.deepEqual((await pg.query<{revision:string;saleRevision:string}>(`SELECT revision::text AS revision,(SELECT revision::text FROM commerce_sales WHERE id=2) AS "saleRevision" FROM finance.accounts WHERE id=$1::bigint`,[managerCustody])).rows[0],beforeBlocked);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[blockedInput.requestId])).rows[0].n,0);
    assert.deepEqual(await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,custodyInput)),{id:savedCustody.id,replayed:true});
    await cancelCashCount(db,"1",{requestId:randomUUID(),countId:openCount.id,reason:"إلغاء جرد اصطناعي"});
    assert.equal((await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,blockedInput))).replayed,false);
    assert.equal(await db.serializable(tx=>pendingTestCollections(tx,managerCustody)),"10.00");
    assert.equal(await count("movements"),custodyMovesBefore);
    const openSettlement=await requestSettlement(db,"990",{requestId:randomUUID(),accountId:managerCustody,expectedBalance:"0",countedAmount:"0",reason:"تسوية مفتوحة اصطناعية",actuallyCounted:true});
    const duringSettlement={...custodyInput,requestId:randomUUID()};
    const beforeSettlementBlock=(await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[managerCustody])).rows[0].revision;
    await assert.rejects(()=>db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,duringSettlement)),(e:unknown)=>e instanceof FinanceProblem && e.code==="custody_pending");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[duringSettlement.requestId])).rows[0].n,0);
    assert.equal((await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[managerCustody])).rows[0].revision,beforeSettlementBlock);
    assert.deepEqual(await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,custodyInput)),{id:savedCustody.id,replayed:true});
    await cancelSettlement(db,"990",{requestId:randomUUID(),settlementId:openSettlement.id,reason:"إلغاء تسوية اصطناعية"});
    assert.equal((await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,990n,duringSettlement))).replayed,false);
  } finally { if (client) await client.$disconnect(); else if (pg) await pg.close(); rmSync(dir, { recursive: true, force: true }); }
});
