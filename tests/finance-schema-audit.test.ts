import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(path.join(process.cwd(), "prisma/manual-finance-schema-audit.sql"), "utf8");

type Relation = { table: string; kind: string; row_security: boolean; force_row_security: boolean; current_role_can_select: boolean };
type Column = { column: string; type: string; nullable: boolean; has_default: boolean; identity: boolean; generated: boolean };
type Constraint = { table: string; name: string; type: string; columns: string[]; references: { table: string; columns: string[] } | null; validated: boolean };
type Audit = { database: string; current_schema: string; public_relations: string[]; financial_relations: Relation[]; columns: Record<string, Column[]>; constraints: Constraint[] };

async function inspect(pg: PGlite): Promise<Audit> {
  await pg.exec("BEGIN READ ONLY");
  try {
    const result = await pg.query<{ finance_schema_audit: string }>(sql);
    return JSON.parse(result.rows[0].finance_schema_audit) as Audit;
  } finally {
    await pg.exec("ROLLBACK");
  }
}

test("finance schema audit reads metadata without fetching row values or literals", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE public.expense_categories (id serial PRIMARY KEY, code text UNIQUE NOT NULL);
      CREATE TABLE public.expenses (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        category_id integer REFERENCES public.expense_categories(id),
        memo text DEFAULT 'SENSITIVE_DEFAULT_SHOULD_NOT_APPEAR',
        amount numeric(14,2) NOT NULL CHECK (amount >= 0),
        internal_note text CHECK (internal_note <> 'SENSITIVE_CHECK_SHOULD_NOT_APPEAR')
      );
      CREATE TABLE public.cash_custody_accounts (id bigint PRIMARY KEY, branch_id bigint NOT NULL);
      CREATE TABLE public.commerce_collections (id bigint PRIMARY KEY, amount numeric(14,2));
      CREATE TABLE public.unrelated_customers (customer_name text, serial_number text);
      INSERT INTO public.unrelated_customers VALUES ('CUSTOMER_SHOULD_NOT_APPEAR', 'SERIAL_SHOULD_NOT_APPEAR');
      INSERT INTO public.expenses (amount, memo) VALUES (10, 'EXPENSE_DATA_SHOULD_NOT_APPEAR');
      ALTER TABLE public.cash_custody_accounts ENABLE ROW LEVEL SECURITY;
    `);
    const result = await inspect(pg);
    const encoded = JSON.stringify(result);
    for (const secret of ["SENSITIVE_DEFAULT_SHOULD_NOT_APPEAR", "SENSITIVE_CHECK_SHOULD_NOT_APPEAR", "CUSTOMER_SHOULD_NOT_APPEAR", "SERIAL_SHOULD_NOT_APPEAR", "EXPENSE_DATA_SHOULD_NOT_APPEAR"]) {
      assert.equal(encoded.includes(secret), false, `${secret} must not be returned`);
    }
    assert.ok(result.public_relations.includes("unrelated_customers"));
    assert.equal(result.columns.unrelated_customers, undefined);
    assert.ok(result.financial_relations.some((item) => item.table === "cash_custody_accounts" && item.kind === "r" && item.row_security));
    assert.ok(result.financial_relations.some((item) => item.table === "commerce_collections" && item.current_role_can_select));
    assert.deepEqual(result.columns.expenses.find((col) => col.column === "amount"), {
      column: "amount", type: "numeric(14,2)", nullable: false, has_default: false, identity: false, generated: false,
    });
    assert.equal(result.columns.expenses.find((col) => col.column === "id")?.identity, true);
    assert.equal(result.columns.expenses.find((col) => col.column === "memo")?.has_default, true);
    assert.ok(result.constraints.some((item) => item.table === "expenses" && item.type === "c"));
    assert.deepEqual(result.constraints.find((item) => item.name === "expenses_category_id_fkey"), {
      table: "expenses", name: "expenses_category_id_fkey", type: "f", columns: ["category_id"],
      references: { table: "public.expense_categories", columns: ["id"] }, validated: true, deferrable: false,
    });
  } finally {
    await pg.close();
  }
});

test("finance schema audit works when no finance tables exist", async () => {
  const pg = new PGlite();
  try {
    const result = await inspect(pg);
    assert.deepEqual(result.public_relations, []);
    assert.deepEqual(result.financial_relations, []);
    assert.deepEqual(result.columns, {});
    assert.deepEqual(result.constraints, []);
  } finally {
    await pg.close();
  }
});

test("SELECT privileges refer to the current inspection role only", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE public.expenses (id integer);
      CREATE TABLE public.expense_categories (id integer);
      CREATE ROLE finance_readonly;
      GRANT USAGE ON SCHEMA public TO finance_readonly;
      GRANT SELECT ON public.expenses TO finance_readonly;
      SET ROLE finance_readonly;
    `);
    const result = await inspect(pg);
    assert.equal(result.financial_relations.find((item) => item.table === "expenses")?.current_role_can_select, true);
    assert.equal(result.financial_relations.find((item) => item.table === "expense_categories")?.current_role_can_select, false);
    assert.ok(result.columns.expense_categories, "catalog inspection must not silently hide the unprivileged table");
  } finally {
    await pg.close();
  }
});
