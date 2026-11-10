# Isolated PostgreSQL concurrency test

`tests/finance-postgres-concurrency.test.ts` creates a **new disposable cluster** in a unique temporary directory, with a private Unix socket and TCP disabled. It never reads `DATABASE_URL`, never connects to an existing server, creates synthetic fixture data and stops/removes its cluster afterward. PostgreSQL binaries must be supplied with `SYNTHETIC_POSTGRES_BIN`; a Linux x64 example, using a pinned test-only npm package outside the repository:

```sh
mkdir -p /tmp/selahtone-postgres-binaries
npm install --prefix /tmp/selahtone-postgres-binaries --no-save --no-package-lock @embedded-postgres/linux-x64@18.6.0-beta.19
# The existing local preview bootstrap prepares Prisma's WASM loader in node_modules.
# Use its own disposable temporary directory, never a real database directory:
preview_dir="$(mktemp -d /tmp/selahtone-loader-XXXXXX)"
PREVIEW_PGLITE_DIR="$preview_dir" node scripts/local-pglite-preview.cjs
rm -rf -- "$preview_dir"
SYNTHETIC_POSTGRES_BIN=/tmp/selahtone-postgres-binaries/node_modules/@embedded-postgres/linux-x64/native/bin npm run check:finance:postgres-concurrency
```

Run as an unprivileged user; PostgreSQL `initdb` refuses root. The WASM Prisma client and `@prisma/adapter-pg` let this environment exercise the real service and real PostgreSQL without the unavailable native Prisma engine. It is not the native Prisma engine used by the deployed app and is not a substitute for testing that exact stack. Uses lock-wait detection and explicit gates, not timing-only assumptions. It covers selected serializable interleavings for collection, holder-cash expense, settlement, count and closure, plus an intentionally manufactured equal-timestamp ambiguity. It covers no other operations, configuration, isolation modes, process crashes, historical data or PostgreSQL versions. It does not perform migrations or operations against any external server. If a test process is forcibly killed before cleanup, the temporary cluster might require manual cleanup.

The same disposable test also exercises the directory service with injected finance-query failure, real lock waits for direct custody opening versus user transfer, request approval versus transfer or suspension, and branch shutdown versus user creation in both orders. Stale pending requests are rejected for approval after a holder moves or is suspended, while rejection remains possible. These are selected interleavings only, through Prisma WASM rather than the native engine; the admin server action itself is not tested over HTTP by these scenarios.

Settlement requests now snapshot the custody revision after their own bump, and confirmation refuses a changed or missing snapshot. The existing PostgreSQL payment/confirmation interleavings exercise this guard and check that zero-movement confirmation also bumps the revision. The separate PGlite engine test manufactures an equal request/payment timestamp to show why timestamp comparison alone is insufficient. This does not resolve equal timestamps at a prior confirmed period boundary or uninstrumented external writes.

The holder-payment/candidate-capture interleavings additionally exercise the real `payExpense` service with a test-only transaction interceptor that attaches the experimental allocation in the same transaction. The capture is still synthetic, not the real `confirmSettlement` action, and no real cash movements are posted by it. The temporary service guard and the interceptor each bump revision, an intentionally unresolved integration detail.

The disposable suite also holds the branch vault while a real cash-collection service with the test-only allocator selects an existing custody. The earlier allocator timed out acquiring the unrelated vault; selecting and locking only the destination avoids that wait. A second interleaving pauses an actual transfer after its vault lock and a real collection after its custody lock, then finishes both and checks replay. The test does not prove safety of all lock orders or concurrent vault-fallback/custody-opening decisions.

Additional selected interleavings now run the real `confirmSettlement` service (including its adjustment and transfer movements) and the real `payExpense` service, each with a test-only allocator invoked inside the service's transaction. Confirmation-first settles its reviewed IDs and the later payment remains pending; payment-first invalidates the real request and no confirmation movement or receipt is saved. The allocator cross-checks current-formula IDs only as an experimental diagnostic; it does not establish historical correctness or production readiness.

At the end, the disposable test opts into a test-only replacement of the permanent custody index. It checks duplicate concurrent openings, opening while closure is uncommitted, and a transaction begun before cash settlement and closure; in that selected interleaving serialization forced an opening retry and prevented a new period from including the earlier cash. This is not a production index migration or a proof that all opening/closing and timestamp scenarios are safe.

After selected real-service confirmation/payment interleavings, the suite also runs the test-only period comparison in a read-only serializable snapshot and verifies that account revision and receipt counts do not change. It is a membership diagnostic, not a production audit or evidence that historical cash was correctly attributed.

The isolated suite also exercises the shared service used by the local user-status command against simultaneous custody opening in both orders. It checks status and session preservation/revocation with an installed finance schema even when the finance flag is absent. It does not run the CLI as an external process or use the native Prisma engine.

The suite also tests four selected interleavings between real holder-cash payment (using the test-only allocation interceptor) and direct count creation or directed holder submission (using the test-only period comparator). It verifies account-lock waits, count-first invalidation by revision, payment-first retry and rejection of an outdated direct count, and the directed submission's recomputed expected cash; the replacement/matching count does not consume the pending payment. It checks selected replay and zero count movements. Holder-cash payment is currently allowed during an open count; these tests do not claim it is blocked. The comparators are not production code, the selected lock sequences do not prove all schedules or historical correctness, and PostgreSQL runs through Prisma WASM.

The same suite manufactures equal-opening-timestamp cases for a real synthetic collection and a real synthetic holder payment. On PostgreSQL the test-only comparator rejects count and closure and the transaction rolls back revision, counts, requests, audit, and movements; the real engine now also rejects these equality cases through its narrower production guard, while the assignment mechanism remains test-only. The equality is deliberately imposed by SQL after the source write, not reconstructed from real history, and these checks do not test a production integration.

The test also runs the experimental receipt inventory in a read-only serializable snapshot against the test-only receipt created alongside a real synthetic confirmation, then deliberately alters and restores a synthetic source amount and checks that fingerprint and total mismatches are reported. No result establishes real historical correctness; the PostgreSQL test still uses Prisma WASM and a disposable schema.

### Additional collection delivery races

The disposable PostgreSQL test also overlaps a real later cash collection with a directed count request: when the collection commits first, the retried request and subsequent holder submission observe the committed amount. It then overlaps two deliveries of the same collection request on the same invoice. An identical payload replays the winning collection, while a changed amount is rejected; exactly one collection and one custody-revision increment remain. The test found that Prisma can wrap a raw invoice-lock serialization failure as `P2010` with SQLSTATE `40001` in metadata. Commerce and catalog transaction retries now recognize that explicit form (and `40P01`), without retrying unrelated errors. `check:transaction-retry` checks supported error shapes and exclusions.

These are selected synthetic lock orders using Prisma WASM and the PostgreSQL adapter, not native Prisma production-engine verification, complete deduplication across all paths, or proof of system-wide deadlock freedom. The invoice remains locked before the replay check; only a new collection, refund, or return increments its revision. PostgreSQL tests check one revision increment for concurrent duplicate collections and rejection of a distinct over-collection; sequential PGlite tests check replay for all three operations. Experimental allocation and the final accounting integration remain separate and incomplete.

### Return, refund and collection against the invoice lock

Additional selected PostgreSQL races use real service functions and newly created synthetic non-stock service invoices. Concurrent identical returns and identical card refunds replay the winner without a second row or revision increment. Distinct full returns cannot return the same quantity twice, and two card refunds cannot exceed the amount due to the customer. A later card collection and full return are exercised in both lock orders: return first rejects collection beyond the revised amount due; collection first permits the subsequent return. The tests pause after the real invoice lock and wait for the competing transaction to block.

Those invoice-lock cases do **not** cover inventory/serial restoration races, cancellation, all roles, or the native Prisma production engine; they do not validate historical reconciliation or the experimental accounting allocation.

### Cash refund account and count races

Two real cash refunds on different returned service invoices compete for one synthetic custody with an opening balance of 10. Without negative acknowledgement, the second debit is rejected after the first commits; its refund and invoice-revision update roll back. Concurrent deliveries of the same cash refund create one refund and one linked movement. The test also exercises a cash refund versus a direct cash count in both lock orders: a refund after an open count is currently permitted but invalidates confirmation by account revision; when the refund commits first, a stale expected count is rejected.

This is selected synthetic concurrency only, not proof of all account operations or of native Prisma, inventory/serial, directed counts, settlement integration, or historical correctness. The commerce refund adapter derives the expected book balance on the server inside the transaction; these tests do not establish that the operator reviewed that balance. Negative acknowledgement intentionally permits a negative result; the closure cases below test that particular behavior.

### Serialized stock return and resale

A real stock sale, return and resale run against one synthetic serial and stock row, with stock decoupling explicitly off. A test gate pauses the return after its serial update but before stock restoration and commit. A concurrent resale still sees the committed sold state and is rejected; its invoice and stock decrement roll back. After the return commits, the identical previously rejected sale request succeeds and owns the serial. Two concurrent copies of the subsequent return produce one return, restore quantity and average cost exactly once, release the serial, and replay without a second invoice-revision change.

This is a selected PostgreSQL interleaving through Prisma WASM, not proof of all row-lock orders, serial races, costing histories, cancellation or stock-decoupled behavior. The synthetic opening and stock baseline do not establish historical inventory correctness.

### Cash refund versus closure and checkpoint gap

In both selected lock orders a real cash refund competes with closing a zero-balance synthetic custody. The request explicitly acknowledges a negative balance: if closure commits first the refund and invoice revision roll back; if the refund commits first the negative balance remains and closure is rejected. Replay does not duplicate the debit.

A separate synthetic diagnostic confirms a cash count and then calls the actual commerce refund service: its movement carries neither a count checkpoint nor an opening attestation. The optional checkpoint guard in the finance hook is not invoked by that bridge. This is an unresolved integration risk: neither the test nor the absence of metadata proves when physical cash was paid or whether historical cash was counted. No historical correction or production migration is performed.

The suite additionally reads `RECORDED_FLOW_SQL` in a read-only snapshot after selected actual synthetic collection and holder-payment services and verifies per-recorder totals and another branch exclusion. This validates a small PostgreSQL example only, not the native Prisma engine, physical event timing, all scopes or large-data performance.
