import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("expense submission announces pending state in both review actions", () => {
  const source = read("../src/app/(app)/finance/expenses/new/expense-form.tsx");
  assert.equal((source.match(/disabled=\{pending \|\| !ready\}\s+aria-busy=\{pending\}/g) ?? []).length, 2);
  assert.equal((source.match(/<span aria-live="polite">\{pending \? "جارٍ الحفظ…"/g) ?? []).length, 2);
  assert.ok(source.includes('className="fin-alert fin-alert--error" role="alert"'));
});

test("transfer and settlement decisions announce pending without changing their guards", () => {
  const transfer = read("../src/app/(app)/finance/transfers/transfer-form.tsx");
  assert.ok(transfer.includes('disabled={pending} aria-busy={pending}'));
  assert.ok(transfer.includes('<span aria-live="polite">{pending ? "جارٍ الحفظ…" : "تأكيد التسليم وإصدار السند"}</span>'));
  assert.ok(transfer.includes('name="actuallyTransferred"'));

  const decisions = read("../src/app/(app)/finance/transfers/settlement-decisions.tsx");
  assert.ok(decisions.includes('disabled={confirming} aria-busy={confirming}'));
  assert.ok(decisions.includes('disabled={rejecting} aria-busy={rejecting}'));
  assert.equal((decisions.match(/<span aria-live="polite">/g) ?? []).length, 2);
  assert.ok(decisions.includes('name="actuallyTransferred"'));
});

test("shared and filtered finance empty states are announced", () => {
  const empty = read("../src/components/finance/fin-empty-state.tsx");
  assert.ok(empty.includes('style={style} role="status"'));

  const ledger = read("../src/app/(app)/finance/transfers/transfers-ledger-view.tsx");
  assert.equal((ledger.match(/className="fin-empty" role="status"/g) ?? []).length, 2);

  const expenses = read("../src/app/(app)/finance/expenses/finance-expenses-view.tsx");
  assert.ok(expenses.includes('className="fin-empty" role="status"'));
});
