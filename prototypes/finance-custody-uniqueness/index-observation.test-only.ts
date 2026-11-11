/** Catalog observations on a disposable synthetic database only. The caller
 * owns the read-only snapshot; opt-in is not authorization. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

type IndexObservation = Record<string, unknown> & {
  oid: string; name: string; valid: boolean; ready: boolean; live: boolean;
  unique: boolean; definition: string; predicate: string | null;
};

/** Report metadata, without declaring any index correct or safe. */
export async function observeSyntheticAccountIndexes(tx: FinanceTransaction, afterOid: string, limit: number): Promise<{ rows: IndexObservation[]; nextAfterOid: string | null }> {
  if (!/^(0|[1-9]\d{0,9})$/.test(afterOid) || BigInt(afterOid) > 4294967295n) throw new Error("invalid synthetic index cursor");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic index page limit");
  const state = await tx.query<{ enabled: string | null; accountTable: boolean }>(`SELECT current_setting('selahtone.custody_uniqueness_test_only', true) AS enabled,
    to_regclass('finance.accounts') IS NOT NULL AS "accountTable"`);
  if (state.rows[0]?.enabled !== "yes") throw new Error("synthetic index observation requires explicit opt-in");
  if (!state.rows[0]?.accountTable) throw new Error("synthetic finance.accounts is unavailable");
  const found = await tx.query<IndexObservation>(`SELECT cls.oid::text AS oid,cls.relname::text AS name,
    idx.indisvalid AS valid,idx.indisready AS ready,idx.indislive AS live,idx.indisunique AS "unique",
    pg_get_indexdef(idx.indexrelid) AS definition,pg_get_expr(idx.indpred,idx.indrelid) AS predicate
    FROM pg_index idx JOIN pg_class cls ON cls.oid=idx.indexrelid
    WHERE idx.indrelid=to_regclass('finance.accounts') AND cls.oid::bigint>$1::bigint
    ORDER BY cls.oid LIMIT $2::int`, [afterOid,limit+1]);
  const rows = found.rows.slice(0,limit);
  return { rows, nextAfterOid: found.rows.length > limit ? rows[rows.length - 1].oid : null };
}
