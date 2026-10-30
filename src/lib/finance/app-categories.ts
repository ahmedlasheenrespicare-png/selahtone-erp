/**
 * Application bridge to the EXISTING public.expense_categories table.
 *
 * Categories are never copied, renamed underneath the ledger or rewritten: this
 * port adds only metadata (revision/creator), an audit trail and an idempotency
 * key, exactly like the reviewed prototype but WITHOUT the disposable-database
 * guard, because the reviewed finance schema is now installed in production.
 *
 * It is reachable only while the staged finance module is switched on, and the
 * engine re-checks the actor (MANAGER/ACCOUNTANT) inside the same transaction.
 * Actor IDs must come from an authenticated server session, never the browser.
 */
import { createHash } from "node:crypto";
import { canManageFinance } from "./policy";
import { identifier, inputObject, requestId, text } from "./validation";
import { FinanceProblem, type Actor, type FinanceCategoryPort, type FinanceCategoryRow, type FinanceDatabase, type FinanceTransaction, type WriteResult } from "./types";

type Row = Record<string, unknown>;
type ActorRow = Row & Actor;
type CategoryRow = Row & { id: string; code: string; name: string; active: boolean; revision: number; createdBy: string | null; updatedBy: string | null };
type Prior = Row & { hash: string; actorId: string; action: string; categoryId: string };
export type AppCategory = CategoryRow & { snapshot: string };

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const categorySnapshot = (category: CategoryRow) =>
  sha(JSON.stringify({ id: category.id, code: category.code, name: category.name, active: category.active, revision: category.revision }));
/** The snapshot the edit command expects, so a screen can send what it displayed. */
export function snapshotOf(category: { id: string; code: string; name: string; active: boolean; revision: number }): string {
  return categorySnapshot({ ...category, createdBy: null, updatedBy: null } as CategoryRow);
}
function dbCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}
/** Re-read the actor from the database under a shared lock; the cookie is not proof. */
async function management(tx: FinanceTransaction, actorId: string): Promise<void> {
  const result = await tx.query<ActorRow>(`SELECT id::text AS id,role_code::text AS role,branch_id::text AS "branchId",status::text AS status,
    must_change_password AS "mustChangePassword" FROM public.users WHERE id=$1::bigint FOR SHARE`, [actorId]);
  if (!canManageFinance(result.rows[0] ?? null)) throw new FinanceProblem("forbidden", "إدارة بنود المصروفات للمدير والمحاسب فقط.");
}
const columns = `p.id::text AS id,p.code,p.name_ar AS name,p.is_active AS active,COALESCE(r.revision,1) AS revision,
 r.created_by::text AS "createdBy",r.updated_by::text AS "updatedBy"`;

async function locked(tx: FinanceTransaction, id: string): Promise<AppCategory> {
  if (BigInt(id) > 2147483647n) throw new FinanceProblem("not_found", "بند المصروف غير موجود.");
  const row = (await tx.query<CategoryRow>(`SELECT ${columns} FROM public.expense_categories p
    LEFT JOIN finance.category_revisions r ON r.category_id=p.id WHERE p.id=$1::int FOR UPDATE OF p`, [id])).rows[0];
  if (!row) throw new FinanceProblem("not_found", "بند المصروف غير موجود.");
  return { ...row, snapshot: categorySnapshot(row) };
}
async function requireNameAvailable(tx: FinanceTransaction, name: string, except: string | null): Promise<void> {
  const duplicate = await tx.query<{ id: string }>(`SELECT id::text AS id FROM public.expense_categories
    WHERE lower(btrim(name_ar))=lower($1::text) AND ($2::int IS NULL OR id<>$2::int) LIMIT 1`, [name, except]);
  if (duplicate.rows[0]) throw new FinanceProblem("category_duplicate", "يوجد بند آخر بالاسم نفسه؛ اختر اسمًا مختلفًا.");
}
async function writeAudit(tx: FinanceTransaction, id: string, actor: string, action: "CREATE" | "EDIT", reason: string | null, before: unknown, after: unknown): Promise<void> {
  await tx.query(`INSERT INTO finance.category_audit(category_id,actor_id,action,reason,before_data,after_data)
   VALUES($1::int,$2::bigint,$3,$4,$5::jsonb,$6::jsonb)`, [id, actor, action, reason, before === null ? null : JSON.stringify(before), JSON.stringify(after)]);
}
/** The category port used by the engine for every finance transaction. */
export function appCategoryPort(tx: FinanceTransaction): FinanceCategoryPort {
  return {
    list: async () => {
      const rows = (await tx.query<CategoryRow>(`SELECT ${columns} FROM public.expense_categories p
        LEFT JOIN finance.category_revisions r ON r.category_id=p.id ORDER BY p.id`)).rows;
      return rows.map((row) => ({ ...row, snapshot: categorySnapshot(row) }));
    },
    lock: (id) => locked(tx, id),
    create: async (name, actorId, id) => {
      await requireNameAvailable(tx, name, null);
      // A legacy-compatible code that cannot collide with hand-written ones.
      const code = `F-${sha(id).slice(0, 28)}`;
      const saved = await tx.query<{ id: string }>(`INSERT INTO public.expense_categories(code,name_ar,is_active)
        VALUES($1,$2,TRUE) RETURNING id::text AS id`, [code, name]);
      await tx.query(`INSERT INTO finance.category_revisions(category_id,revision,created_by,created_at)
        VALUES($1::int,1,$2::bigint,CURRENT_TIMESTAMP)`, [saved.rows[0].id, actorId]);
      return saved.rows[0].id;
    },
    edit: async (before: FinanceCategoryRow, input, actorId) => {
      if (!input.expectedSnapshot || !/^[a-f0-9]{64}$/.test(input.expectedSnapshot)) throw new FinanceProblem("invalid_input", "راجع البند من جديد.");
      if (before.snapshot !== input.expectedSnapshot) throw new FinanceProblem("category_changed", "تغيّر البند منذ عرضه؛ راجعه قبل التعديل.");
      // Existing duplicates are preserved; an unchanged name may still be deactivated.
      if (before.name !== input.name) await requireNameAvailable(tx, input.name, before.id);
      await tx.query(`UPDATE public.expense_categories SET name_ar=$1,is_active=$2 WHERE id=$3::int`, [input.name, input.active, before.id]);
      await tx.query(`INSERT INTO finance.category_revisions(category_id,revision,updated_by,updated_at)
        VALUES($1::int,2,$2::bigint,CURRENT_TIMESTAMP)
        ON CONFLICT(category_id) DO UPDATE SET revision=finance.category_revisions.revision+1,
         updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`, [before.id, actorId]);
    },
  };
}

/** One idempotent command: the same request id never creates a second category. */
async function run(
  db: FinanceDatabase, actorIdRaw: unknown, action: "CREATE" | "EDIT", id: string, payload: unknown,
  work: (tx: FinanceTransaction, actor: string) => Promise<string>,
): Promise<WriteResult> {
  const actor = identifier(actorIdRaw, "المستخدم"), hash = sha(JSON.stringify({ actor, action, payload }));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.serializable(async (tx) => {
        await management(tx, actor);
        const old = (await tx.query<Prior>(`SELECT request_hash AS hash,actor_id::text AS "actorId",action,category_id::text AS "categoryId"
          FROM finance.category_requests WHERE request_id=$1::uuid`, [id])).rows[0] ?? null;
        if (old) {
          if (old.actorId !== actor || old.action !== action || old.hash.trim() !== hash) {
            throw new FinanceProblem("request_conflict", "استُخدم معرّف الطلب ببيانات مختلفة.");
          }
          return { id: old.categoryId, replayed: true };
        }
        const categoryId = await work(tx, actor);
        await tx.query(`INSERT INTO finance.category_requests(request_id,request_hash,actor_id,action,category_id)
         VALUES($1::uuid,$2,$3::bigint,$4,$5::int)`, [id, hash, actor, action, categoryId]);
        return { id: categoryId, replayed: false };
      });
    } catch (error) {
      const code = dbCode(error);
      if (code === "40001" || code === "40P01") {
        if (attempt < 3) continue;
        throw new FinanceProblem("concurrency", "تغيّر البند بالتزامن؛ راجعه وأعد المحاولة.");
      }
      if (code === "23505") {
        let old: Prior | null;
        try {
          old = await db.serializable(async (tx) => {
            await management(tx, actor);
            return (await tx.query<Prior>(`SELECT request_hash AS hash,actor_id::text AS "actorId",action,category_id::text AS "categoryId"
              FROM finance.category_requests WHERE request_id=$1::uuid`, [id])).rows[0] ?? null;
          });
        } catch (readError) {
          if ((dbCode(readError) === "40001" || dbCode(readError) === "40P01") && attempt < 3) continue;
          throw readError;
        }
        if (old) return { id: old.categoryId, replayed: true };
        throw new FinanceProblem("duplicate", "تعذر إنشاء البند بسبب تعارض في الرمز أو الاسم؛ افتح نموذجًا جديدًا.");
      }
      throw error;
    }
  }
  throw new FinanceProblem("concurrency", "تغيّر البند بالتزامن؛ راجعه وأعد المحاولة.");
}

/** Read side for the screens: role is re-checked inside the transaction. */
export async function listAppCategories(db: FinanceDatabase, actorIdRaw: unknown): Promise<AppCategory[]> {
  const actor = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    await management(tx, actor);
    return await appCategoryPort(tx).list() as AppCategory[];
  });
}

export async function createAppCategory(db: FinanceDatabase, actor: unknown, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = { requestId: requestId(value.requestId), name: text(value.name, "اسم البند", 120, true)! };
  return run(db, actor, "CREATE", input.requestId, input, async (tx, actorId) => {
    const id = await appCategoryPort(tx).create(input.name, actorId, input.requestId);
    const code = `F-${sha(input.requestId).slice(0, 28)}`;
    await writeAudit(tx, id, actorId, "CREATE", null, null, { code, name: input.name, active: true, revision: 1 });
    return id;
  });
}

export async function editAppCategory(db: FinanceDatabase, actor: unknown, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw);
  if (typeof value.active !== "boolean") throw new FinanceProblem("invalid_input", "حدد حالة البند.");
  if (typeof value.expectedSnapshot !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedSnapshot)) {
    throw new FinanceProblem("invalid_input", "راجع البند من جديد.");
  }
  const input = {
    requestId: requestId(value.requestId), categoryId: identifier(value.categoryId, "البند"),
    expectedSnapshot: value.expectedSnapshot, name: text(value.name, "اسم البند", 120, true)!,
    active: value.active, reason: text(value.reason, "سبب التعديل", 300, true)!,
  };
  if (BigInt(input.categoryId) > 2147483647n) throw new FinanceProblem("not_found", "بند المصروف غير موجود.");
  return run(db, actor, "EDIT", input.requestId, input, async (tx, actorId) => {
    const port = appCategoryPort(tx), before = await port.lock(input.categoryId);
    await port.edit(before, input, actorId);
    await writeAudit(tx, input.categoryId, actorId, "EDIT", input.reason,
      { name: before.name, active: before.active, revision: before.revision },
      { name: input.name, active: input.active, revision: before.revision + 1 });
    return input.categoryId;
  });
}
