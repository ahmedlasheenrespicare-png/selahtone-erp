# Disposable cash-refund browser test

`tests/finance-refund-browser.test.cjs` starts a loopback Next dev server backed only by a newly created PGlite fixture and uses headless Chromium and Playwright. It tests a synthetic accountant without refund-balance permission: no balance appears in HTML/RSC, opening/count dates and Cairo confirmation time are available, before/unknown answers stop at review, changing accounts clears the timing answer, and an explicitly reviewed refund can be submitted successfully. It does not prove physical payment timing, run against real accounts, exercise every permission or prove production database/browser behavior. Atomicity, replay and lock races are covered separately by service/database tests, not by this browser test.

Install the pinned tools outside the repository and run, for example:

```sh
mkdir -p /tmp/selahtone-browser
npm install --prefix /tmp/selahtone-browser --no-save --ignore-scripts @sparticuz/chromium@133.0.0 playwright-core@1.50.1
SYNTHETIC_BROWSER_DIR=/tmp/selahtone-browser npm run check:finance:refund-browser
```

The test unpacks the browser package's NSS libraries into its disposable directory, and deletes its fixture after stopping the server. The Chromium package includes sandbox-disabling flags for its isolated headless environment; do not run it as a normal browsing profile or against non-test sites. Browser tooling under `/tmp` is not persisted in the repository. Do not run Next HTTP/browser tests concurrently: they share `.next`. No production migration is performed.

## Duplicate-name finance accounts filter

With the same pinned browser tools, run `SYNTHETIC_BROWSER_DIR=/tmp/selahtone-browser npm run check:finance:accounts-browser`. The disposable manager fixture has two branches with identical names and different codes. It checks that selecting either branch shows only its accounts and exports only those rows with distinct branch labels, and that clearing the filter restores all rows. It does not test authorization, other finance screens, or real data.

## Duplicate-name expense branches

`SYNTHETIC_BROWSER_DIR=/tmp/selahtone-browser npm run check:finance:expenses-browser` checks separate per-branch chart values, filters and CSV exports on the expense ledger and today page using a disposable manager fixture. It does not establish server authorization; the branchless and scoped staff case is separately exercised by the synthetic `branchless-expenses` HTTP test.

## Duplicate-name transfer branches

`SYNTHETIC_BROWSER_DIR=/tmp/selahtone-browser npm run check:finance:transfers-browser` checks a manager's branch chart, transfer-form choices, transfer and settlement archive filters and CSVs, voucher branch label, and the recent-100 limit notice. It uses directly seeded, disposable PGlite records, does not submit transfers or settlement decisions, and is not an authorization or production database test.

## Transfer volume and recent ledger

`SYNTHETIC_BROWSER_DIR=/tmp/selahtone-browser npm run check:finance:transfer-volume-browser` seeds more than 100 synthetic transfers and checks the full monthly branch indicators separately from the limited ledger/CSV, plus a staff custody's scoped deposit totals. The movements are directly seeded and do not establish authorization coverage for all roles or proof of physical cash movements.
