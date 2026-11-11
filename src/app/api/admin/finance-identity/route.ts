import "server-only";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getSession } from "@/lib/auth";
import { isSystemAdmin, parseAdminEmails } from "@/lib/access-control";
import { financeEnabled } from "@/lib/finance/db";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const EXPECTED_ROLE = "selahtone_app";

type IdentityMetadata = {
  currentUser: string;
  sessionUser: string;
  transactionReadOnly: boolean;
  role: {
    canLogin: boolean;
    inherit: boolean;
    superuser: boolean;
    bypassRls: boolean;
    createRole: boolean;
    createDb: boolean;
    replication: boolean;
  } | null;
  inheritedRoles: string[];
  privilegedRoles: string[];
  financeObjectsOwned: number;
  financeCreatePrivilege: boolean;
};

class RollbackProbe extends Error {
  constructor(readonly metadata: IdentityMetadata) {
    super("read-only identity probe complete");
  }
}

async function observe(tx: Prisma.TransactionClient): Promise<IdentityMetadata> {
  // This must be the first statement in the transaction. The deliberate error
  // below forces Prisma to roll the observation back instead of committing it.
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");

  const identity = await tx.$queryRaw<Array<{
    current_user: string;
    session_user: string;
    read_only: string;
  }>>`SELECT current_user::text, session_user::text,
    current_setting('transaction_read_only') AS read_only`;
  const role = await tx.$queryRaw<Array<{
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolreplication: boolean;
  }>>`SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls,
    rolcreaterole, rolcreatedb, rolreplication
    FROM pg_roles WHERE rolname = current_user`;
  const inherited = await tx.$queryRaw<Array<{ role: string }>>`
    SELECT parent.rolname::text AS role
    FROM pg_auth_members member
    JOIN pg_roles parent ON parent.oid = member.roleid
    WHERE member.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    ORDER BY parent.rolname`;
  const finance = await tx.$queryRaw<Array<{ owned: number; can_create: boolean }>>`
    SELECT count(c.oid)::int AS owned,
      CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'finance')
        THEN has_schema_privilege(current_user, 'finance', 'CREATE') ELSE false END AS can_create
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner AND r.rolname = current_user
    WHERE n.nspname = 'finance'`;

  const inheritedRoles = inherited.map((row) => row.role);
  const current = identity[0];
  if (!current) throw new Error("identity observation returned no metadata");
  return {
    currentUser: current.current_user,
    sessionUser: current.session_user,
    transactionReadOnly: current.read_only === "on",
    role: role[0] ? {
      canLogin: role[0].rolcanlogin,
      inherit: role[0].rolinherit,
      superuser: role[0].rolsuper,
      bypassRls: role[0].rolbypassrls,
      createRole: role[0].rolcreaterole,
      createDb: role[0].rolcreatedb,
      replication: role[0].rolreplication,
    } : null,
    inheritedRoles,
    privilegedRoles: inheritedRoles.filter((name) => name.startsWith("pg_") || name === "neon_superuser"),
    financeObjectsOwned: finance[0]?.owned ?? 0,
    financeCreatePrivilege: finance[0]?.can_create ?? false,
  };
}

function accepted(metadata: IdentityMetadata): boolean {
  const role = metadata.role;
  return metadata.currentUser === EXPECTED_ROLE &&
    metadata.sessionUser === EXPECTED_ROLE &&
    metadata.transactionReadOnly &&
    role?.canLogin === true && role.inherit === true &&
    !role.superuser && !role.bypassRls && !role.createRole && !role.createDb && !role.replication &&
    metadata.privilegedRoles.length === 0 &&
    metadata.financeObjectsOwned === 0 && !metadata.financeCreatePrivilege;
}

/** Read-only, admin-only proof from the deployed service's own Prisma pool.
 * No connection values, business rows, credentials or SQL error details are
 * returned. It never enables finance or changes database objects. */
export async function GET() {
  const session = await getSession();
  if (!session || session.mustChangePassword) {
    return NextResponse.json({ message: "سجّل الدخول أولًا." }, { status: 401, headers });
  }
  if (!isSystemAdmin(session.role, session.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
    return NextResponse.json({ message: "هذا الفحص متاح للأدمن وحده." }, { status: 403, headers });
  }

  try {
    let metadata: IdentityMetadata | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        const observed = await observe(tx);
        throw new RollbackProbe(observed);
      }, { maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (!(error instanceof RollbackProbe)) throw error;
      metadata = error.metadata;
    }

    // Reaching this branch means the deliberate sentinel left Prisma's
    // transaction through its rollback path; no COMMIT result was accepted.
    if (!metadata) throw new Error("identity observation was not returned");
    const deploymentCommit = process.env.RENDER_GIT_COMMIT ?? process.env.SOURCE_VERSION ?? null;
    return NextResponse.json({
      status: accepted(metadata) && deploymentCommit ? "PASS" : "FAIL",
      scope: "DEPLOYED_SERVICE_OWN_DATABASE_CONNECTION",
      rollbackObserved: true,
      checkedAt: new Date().toISOString(),
      deploymentCommit,
      financeEnabled: financeEnabled(),
      identity: metadata,
    }, { headers });
  } catch {
    return NextResponse.json({
      status: "ERROR",
      message: "تعذّر فحص هوية اتصال الخدمة؛ أبقِ المالية معطلة وراجع إعداد الاتصال.",
    }, { status: 503, headers });
  }
}
