"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { downloadCsvFile } from "@/lib/csv-export";
import { CustodyCloseForm } from "./custody-close-form";

export type FinanceAccountRow = {
  id: string;
  title: string;
  subtitle: string;
  branchId: string;
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

type AccountFilter = "all" | "vault" | "custody" | "over_ceiling" | "closed";

function parseFormattedMoney(raw: string): number {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

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

  const overCeilingIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.kind === "CUSTODY" && !r.isClosed && parseFormattedMoney(r.balanceFormatted) >= custodyCeiling) {
        set.add(r.id);
      }
    }
    return set;
  }, [rows, custodyCeiling]);

  const counts = useMemo(() => {
    let vault = 0;
    let custody = 0;
    let closed = 0;
    for (const r of rows) {
      if (r.isClosed) closed += 1;
      if (r.kind === "VAULT") vault += 1;
      else custody += 1;
    }
    return { all: rows.length, vault, custody, overCeiling: overCeilingIds.size, closed };
  }, [rows, overCeilingIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "vault" && r.kind !== "VAULT") return false;
      if (filter === "custody" && r.kind !== "CUSTODY") return false;
      if (filter === "over_ceiling" && !overCeilingIds.has(r.id)) return false;
      if (filter === "closed" && !r.isClosed) return false;
      if (branchFilter !== "all" && r.branchId !== branchFilter) return false;
      if (q) {
        const hay = `${r.title} ${r.subtitle} ${r.branchName} ${r.kindLabel} ${r.openingDate}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, filter, branchFilter, overCeilingIds]);

  function handleExportCsv(): void {
    downloadCsvFile(
      `selahtone-cash-accounts-${new Date().toISOString().slice(0, 10)}.csv`,
      ["الحساب", "الفرع", "النوع", "تاريخ الجرد", "رصيد الجرد (ج.م)", "الرصيد الحالي (ج.م)", "الحالة"],
      filtered.map((r) => [
        r.title,
        r.branchName,
        r.kindLabel,
        r.openingDate,
        r.recordedOpeningFormatted,
        r.balanceFormatted,
        r.isClosed ? "مقفلة" : r.isNegative ? "سالب" : overCeilingIds.has(r.id) ? "تجاوز سقف العهدة" : "نشط",
      ]),
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
              <option value={10000}>سقف عهدة: 10,000 ج.م</option>
              <option value={15000}>سقف عهدة: 15,000 ج.م</option>
              <option value={25000}>سقف عهدة: 25,000 ج.م</option>
              <option value={50000}>سقف عهدة: 50,000 ج.م</option>
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
            {canManage && counts.overCeiling > 0 ? (
              <button
                type="button"
                role="tab"
                aria-selected={filter === "over_ceiling"}
                className={`fin-filter-pill${filter === "over_ceiling" ? " is-active" : ""}`}
                onClick={() => setFilter("over_ceiling")}
              >
                <span>تجاوزت السقف</span>
                <span className="fin-filter-pill__count">{counts.overCeiling}</span>
              </button>
            ) : null}
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
          <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}>
            <table className="fin-table">
              <caption>الحسابات النقدية — الجرد والرصيد الحالي لكل خزنة وعهدة</caption>
              <thead>
                <tr>
                  <th scope="col">الحساب</th>
                  <th scope="col">النوع</th>
                  <th scope="col">تاريخ الجرد</th>
                  <th scope="col">رصيد الجرد</th>
                  <th scope="col">الرصيد الحالي</th>
                  {canManage ? <th scope="col">إجراء</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => {
                  const isOverCeiling = overCeilingIds.has(account.id);
                  return (
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
                        ) : isOverCeiling ? (
                          <>
                            {" "}
                            <span className="fin-badge b-warn">فوق السقف</span>
                          </>
                        ) : null}
                      </td>
                      {canManage ? (
                        <td>
                          <div className="fin-row-actions">
                            {isOverCeiling ? (
                              <Link
                                href="/finance/transfers"
                                className="fin-button fin-button--secondary"
                              >
                                توريد للخزنة
                              </Link>
                            ) : null}
                            {account.canClose && canCloseCustody ? (
                              <CustodyCloseForm
                                requestId={account.closeRequestId}
                                accountId={account.id}
                                holderName={account.holderName}
                              />
                            ) : !isOverCeiling ? (
                              <span className="fin-field__hint">—</span>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
