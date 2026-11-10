/** Synthetic catalog observation; neither a production audit nor validation. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

type ConstraintRow = Record<string, unknown> & {
  oid: string; name: string; kind: string; validated: boolean;
  enforced: string | null; deferrable: boolean; initiallyDeferred: boolean; definition: string;
};
type ColumnRow = Record<string, unknown> & {
  position: number; name: string; type: string; notNull: boolean; generated: string;
};

async function checkSyntheticTable(tx: FinanceTransaction) {
  const result = await tx.query<{ enabled: string | null; exists: boolean }>(`SELECT current_setting('selahtone.custody_uniqueness_test_only', true) AS enabled,
    to_regclass('finance.accounts') IS NOT NULL AS "exists"`);
  if (result.rows[0]?.enabled !== "yes") throw new Error("synthetic constraint observation requires explicit opt-in");
  if (!result.rows[0]?.exists) throw new Error("synthetic finance.accounts is unavailable");
}

/** Metadata only: a constraint's name or validated flag is not semantic proof. */
export async function observeSyntheticAccountConstraints(tx: FinanceTransaction, afterOid: string, limit: number): Promise<{ rows: ConstraintRow[]; nextAfterOid: string | null }> {
  if (!/^(0|[1-9]\d{0,9})$/.test(afterOid) || BigInt(afterOid) > 4294967295n) throw new Error("invalid synthetic constraint cursor");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic page limit");
  await checkSyntheticTable(tx);
  const result = await tx.query<ConstraintRow>(`SELECT c.oid::text AS oid,c.conname::text AS name,c.contype::text AS kind,
    c.convalidated AS validated,to_jsonb(c)->>'conenforced' AS enforced,
    c.condeferrable AS deferrable,c.condeferred AS "initiallyDeferred",pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE c.conrelid=to_regclass('finance.accounts') AND c.oid::bigint>$1::bigint ORDER BY c.oid LIMIT $2::int`, [afterOid,limit+1]);
  const rows = result.rows.slice(0,limit);
  return { rows, nextAfterOid: result.rows.length > limit ? rows[rows.length-1].oid : null };
}

/** Column not-null flags are observed, not a full check of domains or triggers. */
export async function observeSyntheticAccountColumns(tx: FinanceTransaction, afterPosition: number, limit: number): Promise<{ rows: ColumnRow[]; nextAfterPosition: number | null }> {
  if (!Number.isInteger(afterPosition) || afterPosition < 0 || afterPosition > 32767) throw new Error("invalid synthetic column cursor");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic page limit");
  await checkSyntheticTable(tx);
  const result = await tx.query<ColumnRow>(`SELECT a.attnum::int AS position,a.attname::text AS name,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS "notNull",a.attgenerated::text AS generated
    FROM pg_attribute a WHERE a.attrelid=to_regclass('finance.accounts') AND a.attnum>$1::int AND NOT a.attisdropped
    ORDER BY a.attnum LIMIT $2::int`, [afterPosition,limit+1]);
  const rows = result.rows.slice(0,limit);
  return { rows, nextAfterPosition: result.rows.length > limit ? rows[rows.length-1].position : null };
}
