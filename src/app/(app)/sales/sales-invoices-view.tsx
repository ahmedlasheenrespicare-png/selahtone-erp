"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";

export type SalesInvoiceStatusKind = "confirmed" | "partial_return" | "full_return" | "cancelled";

export type SalesInvoiceRow = {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  originalFormatted: string;
  dueFromCustomerFormatted: string;
  dueToCustomerFormatted: string;
  hasDueFromCustomer: boolean;
  hasDueToCustomer: boolean;
  statusLabel: string;
  statusKind: SalesInvoiceStatusKind;
  createdAtFormatted: string;
  linesCount: number;
};

type FilterTab = "all" | "confirmed" | "due_from" | "due_to" | "returns";

export default function SalesInvoicesView({
  rows,
  branches,
}: {
  rows: SalesInvoiceRow[];
  branches: string[];
}) {
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("ALL");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const counts = useMemo(() => {
    return {
      all: rows.length,
      confirmed: rows.filter((r) => r.statusKind === "confirmed").length,
      due_from: rows.filter((r) => r.hasDueFromCustomer).length,
      due_to: rows.filter((r) => r.hasDueToCustomer).length,
      returns: rows.filter((r) => r.statusKind !== "confirmed").length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (branchFilter !== "ALL" && row.branchName !== branchFilter) return false;
      if (activeTab === "confirmed" && row.statusKind !== "confirmed") return false;
      if (activeTab === "due_from" && !row.hasDueFromCustomer) return false;
      if (activeTab === "due_to" && !row.hasDueToCustomer) return false;
      if (activeTab === "returns" && row.statusKind === "confirmed") return false;
      if (!q) return true;
      return (
        row.code.toLowerCase().includes(q) ||
        row.id.includes(q) ||
        row.customerName.toLowerCase().includes(q) ||
        row.customerPhone.toLowerCase().includes(q) ||
        row.branchName.toLowerCase().includes(q)
      );
    });
  }, [rows, query, branchFilter, activeTab]);

  const tabs: Array<{ id: FilterTab; label: string; count: number }> = [
    { id: "all", label: "الكل", count: counts.all },
    { id: "confirmed", label: "مؤكدة", count: counts.confirmed },
    { id: "due_from", label: "عليها متبقٍ", count: counts.due_from },
    ...(counts.due_to > 0 ? [{ id: "due_to" as const, label: "مستحق للعميل", count: counts.due_to }] : []),
    { id: "returns", label: "مرتجعات وملغاة", count: counts.returns },
  ];

  return (
    <section className="sales-board" aria-label="سجل الفواتير">
      <div className="sales-toolbar">
        <div className="sales-toolbar__filters" role="tablist" aria-label="تصفية الفواتير حسب الحالة">
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`sales-filter-pill${selected ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                <b className="sales-filter-pill__count">{tab.count}</b>
              </button>
            );
          })}
        </div>

        <div className="sales-toolbar__controls">
          {branches.length > 1 ? (
            <label className="sales-branch-select" aria-label="تصفية حسب الفرع">
              <AppIcon name="branch" />
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="ALL">كل الفروع ({branches.length})</option>
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="sales-search-box">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث برقم الفاتورة أو اسم العميل أو الهاتف…"
              aria-label="البحث في الفواتير"
            />
            {query ? (
              <button
                type="button"
                className="sales-search-box__clear"
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
              >
                <AppIcon name="close" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="inv-panel sales-empty-filter">
          <p>لا توجد فواتير مطابقة لخيارات البحث أو التصفية الحالية.</p>
          <button
            type="button"
            className="inv-button inv-button--secondary"
            onClick={() => {
              setQuery("");
              setBranchFilter("ALL");
              setActiveTab("all");
            }}
          >
            إعادة ضبط التصفية
          </button>
        </div>
      ) : (
        <div className="sales-table-card">
          <div className="inv-table-wrap table-wrap" role="region" aria-label="جدول فواتير البيع" tabIndex={0}>
            <table className="inv-table sales-invoices-table">
              <thead>
                <tr>
                  <th>الفاتورة</th>
                  <th>العميل</th>
                  <th>الفرع</th>
                  <th>الإجمالي الأصلي</th>
                  <th>المتبقي على العميل</th>
                  <th>مستحق للعميل</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                  <th aria-label="تفاصيل" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((sale) => {
                  const chipClass =
                    sale.statusKind === "cancelled"
                      ? "sale-chip--neutral"
                      : sale.statusKind !== "confirmed"
                        ? "sale-chip--warning"
                        : "sale-chip--confirmed";
                  const initial = Array.from(sale.customerName.trim())[0] ?? "ع";

                  return (
                    <tr key={sale.id} className={sale.statusKind === "cancelled" ? "is-cancelled-row" : undefined}>
                      <td>
                        <Link href={`/sales/${sale.id}`} className="sales-invoice-badge">
                          <AppIcon name="receipt" />
                          <bdi dir="ltr">{sale.code}</bdi>
                        </Link>
                        <small className="sales-lines-hint">{sale.linesCount} {sale.linesCount === 1 ? "بند" : "بنود"}</small>
                      </td>
                      <td>
                        <div className="sales-customer-cell">
                          <span className="sales-customer-cell__avatar" aria-hidden="true">
                            {initial}
                          </span>
                          <div>
                            <strong>{sale.customerName}</strong>
                            <span className="sales-customer-cell__phone">
                              <bdi dir="ltr">{sale.customerPhone}</bdi>
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="sales-branch-pill">{sale.branchName}</span>
                      </td>
                      <td className="sales-money-cell is-strong">
                        <bdi dir="ltr">{sale.originalFormatted}</bdi> <small>ج.م</small>
                      </td>
                      <td className={`sales-money-cell${sale.hasDueFromCustomer ? " is-due-from" : " is-zero"}`}>
                        <bdi dir="ltr">{sale.dueFromCustomerFormatted}</bdi> <small>ج.م</small>
                      </td>
                      <td className={`sales-money-cell${sale.hasDueToCustomer ? " is-due-to" : " is-zero"}`}>
                        <bdi dir="ltr">{sale.dueToCustomerFormatted}</bdi> <small>ج.م</small>
                      </td>
                      <td>
                        <span className={`sale-chip ${chipClass}`}>
                          <span className="sale-chip__dot" aria-hidden="true" />
                          {sale.statusLabel}
                        </span>
                      </td>
                      <td className="sales-date-cell">{sale.createdAtFormatted}</td>
                      <td className="sales-open-cell">
                        <Link href={`/sales/${sale.id}`} className="sales-open-link" aria-label={`فتح فاتورة ${sale.code}`}>
                          <span>عرض</span>
                          <AppIcon name="arrow" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
