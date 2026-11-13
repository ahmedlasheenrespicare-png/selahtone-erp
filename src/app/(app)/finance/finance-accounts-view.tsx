"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { downloadCsvFile } from "@/lib/csv-export";
import { csvHeaders, csvRows, filterRowsBySearch } from "@/lib/data-driven-ui";
import { CustodyCloseForm } from "./custody-close-form";

import {
  createAccountFilters,
  createFinanceAccountColumns,
  createFinanceAccountCsvColumns,
  custodyCeilingOptions,
  financeAccountSearch,
  findOverCeilingIds,
  type AccountFilter,
  type FinanceAccountRow,
} from "./finance-accounts-metadata";

export type { FinanceAccountRow } from "./finance-accounts-metadata";

export default function FinanceAccountsView({
  rows,
  branches,
  canManage,
  canCloseCustody,
}: {
  rows: FinanceAccountRow[];
  branches: Array<{ id: string; label: string }>;
  canManage: boolean;
  canCloseCustody: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [custodyCeiling, setCustodyCeiling] = useState<number>(15000);

  const overCeilingIds = useMemo(() => findOverCeilingIds(rows, custodyCeiling), [rows, custodyCeiling]);
  const accountFilters = useMemo(() => createAccountFilters(overCeilingIds), [overCeilingIds]);
  const visibleFilters = accountFilters.filter((item) => item.id !== "over_ceiling" || canManage).filter((item) => item.isVisible?.(rows) ?? true);
  const counts = Object.fromEntries(accountFilters.map((item) => [item.id, rows.filter(item.matches).length])) as Record<AccountFilter, number>;

  const filtered = useMemo(() => {
    const activeFilter = accountFilters.find((item) => item.id === filter) ?? accountFilters[0];
    const selected = rows.filter((row) => activeFilter.matches(row) && (branchFilter === "all" || row.branchId === branchFilter));
    return filterRowsBySearch(selected, query, financeAccountSearch.text);
  }, [rows, query, filter, branchFilter, accountFilters]);

  function handleExportCsv(): void {
    const columns = createFinanceAccountCsvColumns(overCeilingIds);
    downloadCsvFile(
      `selahtone-cash-accounts-${new Date().toISOString().slice(0, 10)}.csv`,
      csvHeaders(columns), csvRows(filtered, columns),
    );
  }

  return (
    <>
      {canManage && overCeilingIds.size > 0 ? (
        <div className="fin-alert fin-alert--warn" role="status">
          <strong>تنبيه سقف العهدة:</strong> يوجد {overCeilingIds.size} عهدة موظف تجاوز رصيدها النقدي سقف{" "}
          <bdi dir="ltr">{custodyCeiling.toLocaleString("en-US")}</bdi> ج.م وتوصى الإدارة بتوريدها إلى خزنة الفرع.{" "}
          <Link href="/finance/transfers" className="fin-inline-link">
            فتح شاشة التسليم ←
          </Link>
        </div>
      ) : null}

      <div className="fin-toolbar" role="region" aria-label="تصفية الحسابات النقدية">
        <div className="fin-toolbar__row">
          <div className="fin-search-box">
            <svg className="fin-search-box__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.3" y2="16.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={financeAccountSearch.placeholder}
              aria-label="بحث في الحسابات النقدية"
            />
            {query ? (
              <button
                type="button"
                className="fin-search-box__clear"
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
              >
                <AppIcon name="close" />
              </button>
            ) : null}
          </div>

          {branches.length > 1 ? (
            <select
              className="fin-branch-select"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="تصفية حسب الفرع"
            >
              <option value="all">كل الفروع ({branches.length})</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.label}
                </option>
              ))}
            </select>
          ) : null}

          {canManage ? (
            <select
              className="fin-branch-select"
              value={custodyCeiling}
              onChange={(e) => setCustodyCeiling(Number(e.target.value))}
              aria-label="سقف تنبيه العهدة"
            >
              {custodyCeilingOptions.map((option) => <option key={option.value} value={Number(option.value)}>{option.label}</option>)}
            </select>
          ) : null}

          <button
            type="button"
            className="fin-button fin-button--secondary"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
          >
            <AppIcon name="download" />
            <span>تصدير CSV ({filtered.length})</span>
          </button>
        </div>

        <div className="fin-toolbar__row">
          <div className="fin-filter-pills" role="tablist" aria-label="تصنيف الحسابات">
            {visibleFilters.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`fin-filter-pill${filter === item.id ? " is-active" : ""}`} onClick={() => setFilter(item.id)}>
                <span>{item.label}</span><span className="fin-filter-pill__count">{counts[item.id]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>الأرصدة الحالية</h2>
          <p>
            الرصيد = رصيد الجرد المسجَّل + الحركات اللاحقة. السالب مسموح مع تنبيه. وهو <strong>غير</strong> «المتوقَّع بيد الموظف»
            الذي تحسبه التسوية، لأن المتوقَّع يضيف مبيعات الفترة ويخصم مصروفاتها.
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="fin-empty">لا توجد حسابات تطابق معايير البحث أو التصفية الحالية.</div>
        ) : (
          <DataTable
            rows={filtered}
            columns={createFinanceAccountColumns({
              overCeilingIds, canManage, canCloseCustody,
              renderCloseAction: (account) => <CustodyCloseForm requestId={account.closeRequestId} accountId={account.id} holderName={account.holderName} />,
            })}
            rowKey={(account) => account.id}
            regionLabel="جدول مالي قابل للتمرير"
            regionClassName="fin-table-wrap"
            tableClassName="fin-table"
            caption="الحسابات النقدية — الجرد والرصيد الحالي لكل خزنة وعهدة"
          />
        )}
      </div>
    </>
  );
}
