"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { CustodyCloseForm } from "./custody-close-form";

export type FinanceAccountRow = {
  id: string;
  title: string;
  subtitle: string;
  branchName: string;
  kind: "VAULT" | "CUSTODY";
  kindLabel: string;
  openingDate: string;
  recordedOpeningFormatted: string;
  balanceFormatted: string;
  isNegative: boolean;
  isClosed: boolean;
  canClose: boolean;
  closeRequestId: string;
  holderName: string;
};

type AccountFilter = "all" | "vault" | "custody" | "closed";

export default function FinanceAccountsView({
  rows,
  branches,
  canManage,
}: {
  rows: FinanceAccountRow[];
  branches: string[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [branchFilter, setBranchFilter] = useState("all");

  const counts = useMemo(() => {
    let vault = 0;
    let custody = 0;
    let closed = 0;
    for (const r of rows) {
      if (r.isClosed) closed += 1;
      if (r.kind === "VAULT") vault += 1;
      else custody += 1;
    }
    return { all: rows.length, vault, custody, closed };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "vault" && r.kind !== "VAULT") return false;
      if (filter === "custody" && r.kind !== "CUSTODY") return false;
      if (filter === "closed" && !r.isClosed) return false;
      if (branchFilter !== "all" && r.branchName !== branchFilter) return false;
      if (q) {
        const hay = `${r.title} ${r.subtitle} ${r.branchName} ${r.kindLabel} ${r.openingDate}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, filter, branchFilter]);

  return (
    <>
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
              placeholder="ابحث باسم الفرع أو الموظف أو تاريخ الجرد…"
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
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="fin-toolbar__row">
          <div className="fin-filter-pills" role="tablist" aria-label="تصنيف الحسابات">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={`fin-filter-pill${filter === "all" ? " is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              <span>كل الحسابات</span>
              <span className="fin-filter-pill__count">{counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "vault"}
              className={`fin-filter-pill${filter === "vault" ? " is-active" : ""}`}
              onClick={() => setFilter("vault")}
            >
              <span>خزائن الفروع</span>
              <span className="fin-filter-pill__count">{counts.vault}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "custody"}
              className={`fin-filter-pill${filter === "custody" ? " is-active" : ""}`}
              onClick={() => setFilter("custody")}
            >
              <span>عُهَد الموظفين</span>
              <span className="fin-filter-pill__count">{counts.custody}</span>
            </button>
            {counts.closed > 0 ? (
              <button
                type="button"
                role="tab"
                aria-selected={filter === "closed"}
                className={`fin-filter-pill${filter === "closed" ? " is-active" : ""}`}
                onClick={() => setFilter("closed")}
              >
                <span>مقفلة</span>
                <span className="fin-filter-pill__count">{counts.closed}</span>
              </button>
            ) : null}
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
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>الحساب</th>
                  <th>النوع</th>
                  <th>تاريخ الجرد</th>
                  <th>رصيد الجرد</th>
                  <th>الرصيد الحالي</th>
                  {canManage ? <th>إجراء</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="fin-account-cell">
                        <strong>{account.title}</strong>
                        <small>{account.subtitle}</small>
                      </div>
                    </td>
                    <td>
                      <span className={`fin-badge ${account.kind === "VAULT" ? "fin-badge--vault" : "fin-badge--custody"}`}>
                        {account.kindLabel}
                      </span>
                    </td>
                    <td>
                      <bdi dir="ltr">{account.openingDate}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{account.recordedOpeningFormatted}</bdi>
                    </td>
                    <td>
                      <span className={`fin-money${account.isNegative ? " fin-money--negative" : ""}`}>
                        <bdi dir="ltr">{account.balanceFormatted}</bdi>
                      </span>
                      {account.isClosed ? (
                        <>
                          {" "}
                          <span className="fin-badge fin-badge--closed">مقفلة</span>
                        </>
                      ) : account.isNegative ? (
                        <>
                          {" "}
                          <span className="fin-badge fin-badge--negative">سالب</span>
                        </>
                      ) : null}
                    </td>
                    {canManage ? (
                      <td>
                        {account.canClose ? (
                          <CustodyCloseForm
                            requestId={account.closeRequestId}
                            accountId={account.id}
                            holderName={account.holderName}
                          />
                        ) : (
                          <span className="fin-field__hint">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
