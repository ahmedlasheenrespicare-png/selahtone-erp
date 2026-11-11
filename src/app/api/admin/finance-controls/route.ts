import "server-only";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getSession } from "@/lib/auth";
import { isSystemAdmin, parseAdminEmails } from "@/lib/access-control";
import { financeEnabled } from "@/lib/finance/db";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

type ControlsMetadata = {
  schemas: Array<{ schema: string; tables: number; rlsEnabled: number; rlsForced: number; policies: number; tableNames: string[] }>;
  migrationLedgerStatus: "READ" | "NOT_PRESENT" | "NOT_READABLE_BY_APP_ROLE";
  migrationLedger: Array<{ name: string; checksum: string; appliedAt: string; appliedBy: string }>;
  ownership: { objects: number; ownedByAdmin: number; ownedByApp: number; mismatches: string[] };
  privileges: {
    tables: number;
    selectDenied: number;
    insertDenied: number;
    updateDenied: number;
    deleteAllowed: number;
    truncateAllowed: number;
  };
  triggers: Array<{ table: string; name: string; enabled: string; definition: string }>;
};

class RollbackProbe extends Error {
  constructor(readonly metadata: ControlsMetadata) { super("read-only controls probe complete"); }
}

async function observe(tx: Prisma.TransactionClient): Promise<ControlsMetadata> {
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");

  const schemas = await tx.$queryRawUnsafe<ControlsMetadata["schemas"]>(`
    WITH relations AS (
      SELECT n.nspname, c.oid, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','finance') AND c.relkind='r'
    ), policy_counts AS (
      SELECT p.polrelid, count(*)::int AS policies FROM pg_policy p GROUP BY p.polrelid
    )
    SELECT nspname AS schema, count(*)::int AS tables,
      count(*) FILTER (WHERE relrowsecurity)::int AS "rlsEnabled",
      count(*) FILTER (WHERE relforcerowsecurity)::int AS "rlsForced",
      COALESCE(sum(pc.policies),0)::int AS policies
    FROM relations r LEFT JOIN policy_counts pc ON pc.polrelid=r.oid
    GROUP BY nspname ORDER BY nspname`);
  for (const schema of schemas) {
    schema.tableNames = (await tx.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname`, schema.schema,
    )).map((row) => row.name);
  }
  // The application role deliberately need not read the release ledger. Test
  // both USAGE and SELECT before referencing it: a permission error would abort
  // the whole read-only transaction and hide the otherwise readable controls.
  const ledgerExists = await tx.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT to_regclass('finance_release.migrations') IS NOT NULL AS present`,
  );
  const present = ledgerExists[0]?.present === true;
  // Privilege functions taking object names reject a missing schema, so only
  // call them after the catalog lookup proves the relation exists.
  const ledgerAccess = present
    ? await tx.$queryRawUnsafe<Array<{ readable: boolean }>>(`
        SELECT COALESCE(has_schema_privilege(current_user,'finance_release','USAGE'),false)
          AND COALESCE(has_table_privilege(current_user,'finance_release.migrations','SELECT'),false)
          AS readable`)
    : [];
  const readable = present && ledgerAccess[0]?.readable === true;
  const migrationLedgerStatus = readable ? "READ" : present ? "NOT_READABLE_BY_APP_ROLE" : "NOT_PRESENT";
  const migrationLedger = readable
    ? await tx.$queryRawUnsafe<ControlsMetadata["migrationLedger"]>(`
        SELECT name::text, checksum::text, applied_at::text AS "appliedAt", applied_by::text AS "appliedBy"
        FROM finance_release.migrations ORDER BY name`)
    : [];
  const ownership = await tx.$queryRawUnsafe<Array<{ objects: number; ownedByAdmin: number; ownedByApp: number }>>(`
    SELECT count(*)::int AS objects,
      count(*) FILTER (WHERE pg_get_userbyid(c.relowner)='selahtone_finance_admin')::int AS "ownedByAdmin",
      count(*) FILTER (WHERE pg_get_userbyid(c.relowner)='selahtone_app')::int AS "ownedByApp"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance'`);
  const mismatches = await tx.$queryRawUnsafe<Array<{ object: string }>>(`
    SELECT (c.relkind::text || ':' || c.relname)::text AS object
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='finance' AND pg_get_userbyid(c.relowner)<>'selahtone_finance_admin'
    ORDER BY c.relname`);
  const privileges = await tx.$queryRawUnsafe<Array<ControlsMetadata["privileges"]>>(`
    SELECT count(*)::int AS tables,
      count(*) FILTER (WHERE NOT has_table_privilege(current_user,c.oid,'SELECT'))::int AS "selectDenied",
      count(*) FILTER (WHERE NOT has_table_privilege(current_user,c.oid,'INSERT'))::int AS "insertDenied",
      count(*) FILTER (WHERE NOT has_table_privilege(current_user,c.oid,'UPDATE'))::int AS "updateDenied",
      count(*) FILTER (WHERE has_table_privilege(current_user,c.oid,'DELETE'))::int AS "deleteAllowed",
      count(*) FILTER (WHERE has_table_privilege(current_user,c.oid,'TRUNCATE'))::int AS "truncateAllowed"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='finance' AND c.relkind='r'`);
  const triggers = await tx.$queryRawUnsafe<ControlsMetadata["triggers"]>(`
    SELECT c.relname::text AS table, t.tgname::text AS name, t.tgenabled::text AS enabled,
      pg_get_triggerdef(t.oid)::text AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='finance' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);

  return {
    schemas,
    migrationLedgerStatus,
    migrationLedger,
    ownership: {
      objects: ownership[0]?.objects ?? 0,
      ownedByAdmin: ownership[0]?.ownedByAdmin ?? 0,
      ownedByApp: ownership[0]?.ownedByApp ?? 0,
      mismatches: mismatches.map((row) => row.object),
    },
    privileges: privileges[0] ?? { tables: 0, selectDenied: 0, insertDenied: 0, updateDenied: 0, deleteAllowed: 0, truncateAllowed: 0 },
    triggers,
  };
}

/** Metadata only: this describes database controls; it does not claim that RLS
 * or a trigger has been exercised. No business rows or connection values are
 * returned, and the observation always rolls back. */
export async function GET() {
  const session = await getSession();
  if (!session || session.mustChangePassword) {
    return NextResponse.json({ message: "سجّل الدخول أولًا." }, { status: 401, headers });
  }
  if (!isSystemAdmin(session.role, session.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
    return NextResponse.json({ message: "هذا الفحص متاح للأدمن وحده." }, { status: 403, headers });
  }
  try {
    let metadata: ControlsMetadata | null = null;
    try {
      await prisma.$transaction(async (tx) => { throw new RollbackProbe(await observe(tx)); }, { maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (!(error instanceof RollbackProbe)) throw error;
      metadata = error.metadata;
    }
    if (!metadata) throw new Error("controls observation was not returned");
    return NextResponse.json({
      status: "OBSERVED_NOT_AN_ENFORCEMENT_TEST",
      scope: "DEPLOYED_SERVICE_OWN_DATABASE_CONNECTION",
      rollbackObserved: true,
      checkedAt: new Date().toISOString(),
      deploymentCommit: process.env.RENDER_GIT_COMMIT ?? process.env.SOURCE_VERSION ?? null,
      financeEnabled: financeEnabled(),
      controls: metadata,
    }, { headers });
  } catch {
    return NextResponse.json({ status: "ERROR", message: "تعذّر فحص ضوابط قاعدة البيانات؛ أبقِ المالية معطلة." }, { status: 503, headers });
  }
}
