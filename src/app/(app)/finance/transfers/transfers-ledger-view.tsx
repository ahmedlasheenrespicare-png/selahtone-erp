"use client";

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { downloadCsvFile } from "@/lib/csv-export";
import { csvHeaders, csvRows, filterRowsBySearch } from "@/lib/data-driven-ui";
import HandoverVoucher, { triggerVoucherPrint, type HandoverVoucherData } from "./handover-voucher";
import {
  createTransferLedgerColumns,
  settlementArchiveColumns,
  settlementArchiveCsvColumns,
  settlementArchiveFilters,
  settlementArchiveSearch,
  transferLedgerCsvColumns,
  transferLedgerFilters,
  transferLedgerSearch,
  visibleTransferLedgerFilters,
  type ArchivedSettlementRow,
  type ArchiveStatusFilter,
  type TransferLedgerFilter,
  type TransferLedgerRow,
} from "./transfers-ledger-metadata";

export type { ArchivedSettlementRow, TransferLedgerRow } from "./transfers-ledger-metadata";

export default function TransfersLedgerView({
  transfers,
  archivedSettlements,
  branches,
  canManage,
}: {
  transfers: TransferLedgerRow[];
  archivedSettlements: ArchivedSettlementRow[];
  branches: Array<{ id: string; label: string }>;
  canManage: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"transfers" | "settlements">("transfers");
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [ledgerFilter, setLedgerFilter] = useState<TransferLedgerFilter>("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveStatusFilter>("all");
  const [selectedVoucher, setSelectedVoucher] = useState<HandoverVoucherData | null>(null);

  const transferCounts = useMemo(() => Object.fromEntries(
    transferLedgerFilters.map((filter) => [filter.id, transfers.filter(filter.matches).length]),
  ) as Record<TransferLedgerFilter, number>, [transfers]);
  const archiveCounts = useMemo(() => Object.fromEntries(
    settlementArchiveFilters.map((filter) => [filter.id, archivedSettlements.filter(filter.matches).length]),
  ) as Record<ArchiveStatusFilter, number>, [archivedSettlements]);
  const ledgerFilters = useMemo(() => visibleTransferLedgerFilters(canManage), [canManage]);

  const filteredTransfers = useMemo(() => {
    const filter = transferLedgerFilters.find((item) => item.id === ledgerFilter) ?? transferLedgerFilters[0];
    const selected = transfers.filter((row) =>
      (branchFilter === "all" || row.branchId === branchFilter) && filter.matches(row),
    );
    return filterRowsBySearch(selected, query, transferLedgerSearch.text);
  }, [transfers, query, branchFilter, ledgerFilter]);

  const filteredArchive = useMemo(() => {
    const filter = settlementArchiveFilters.find((item) => item.id === archiveFilter) ?? settlementArchiveFilters[0];
    const selected = archivedSettlements.filter((row) =>
      (branchFilter === "all" || row.branchId === branchFilter) && filter.matches(row),
    );
    return filterRowsBySearch(selected, query, settlementArchiveSearch.text);
  }, [archivedSettlements, query, branchFilter, archiveFilter]);

  function handleLedgerTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // قائمة RTL: الأيسر للتالي والأيمن للسابق.
    const delta = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = activeTab === "transfers" ? "settlements" : "transfers";
    setActiveTab(next);
    document.getElementById(`fin-ledger-tab-${next}`)?.focus();
  }

  function handleExportTransfersCsv() {
    downloadCsvFile(
      `selahtone-cash-transfers-${new Date().toISOString().slice(0, 10)}.csv`,
      csvHeaders(transferLedgerCsvColumns),
      csvRows(filteredTransfers, transferLedgerCsvColumns),
    );
  }

  function handleExportArchiveCsv() {
    downloadCsvFile(
      `selahtone-settlements-archive-${new Date().toISOString().slice(0, 10)}.csv`,
      csvHeaders(settlementArchiveCsvColumns),
      csvRows(filteredArchive, settlementArchiveCsvColumns),
    );
  }

  function handlePrintRowVoucher(row: TransferLedgerRow) {
    setSelectedVoucher({
      voucherNumber: row.id,
      branchName: row.branchName,
      timestampLabel: row.timestampFormatted,
      fromLabel: row.fromLabel,
      toLabel: row.toLabel,
      amount: row.amount,
      originLabel: row.settlementId
        ? `تحويل تسوية عهدة معتمدة (#${row.settlementId})`
        : row.direction === "TO_VAULT"
          ? "توريد نقدي مباشر إلى خزنة الفرع"
          : "تغذية نقدية مباشرة من خزنة الفرع",
      actorName: row.actorName,
    });
    window.setTimeout(() => triggerVoucherPrint(), 30);
  }

  const transferColumns = createTransferLedgerColumns(handlePrintRowVoucher);

  return (
    <div className="fin-panel" id="transfers-directory">
      <div className="fin-panel__heading fin-panel__heading--split">
        <div>
          <h2>{activeTab === "transfers" ? "سجل حركات التسليم والتوريد النقدي" : "أرشيف قرارات التسوية السابقة"}</h2>
          <p>{activeTab === "transfers"
            ? "آخر 100 حركة متاحة حسب رقم التسجيل، مع المنفِّذ وأصل الحركة وإمكانية طباعة السند أو تصدير الصفوف المعروضة. قد لا يشمل السجل كل الحركات."
            : "سجل التسويات المعتمدة والمرفوضة والملغاة مع بيان القرار ومنفّذه."}</p>
        </div>

        {canManage ? (
          <div className="fin-filter-pills no-print" role="tablist" aria-label="تبديل السجل الرقابي" onKeyDown={handleLedgerTabKeyDown}>
            {(["transfers", "settlements"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`fin-ledger-tab-${tab}`}
                aria-controls="fin-ledger-panel"
                tabIndex={activeTab === tab ? 0 : -1}
                aria-selected={activeTab === tab}
                className={`fin-filter-pill${activeTab === tab ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                <span>{tab === "transfers" ? "حركات التسليم" : "أرشيف التسويات"}</span>
                <span className="fin-filter-pill__count">{tab === "transfers" ? transfers.length : archivedSettlements.length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="fin-panel__body">
        <div className="fin-toolbar no-print" role="region" aria-label="أدوات البحث والتصفية">
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
                placeholder={activeTab === "transfers" ? transferLedgerSearch.placeholder : settlementArchiveSearch.placeholder}
                aria-label="بحث في السجل"
              />
              {query ? (
                <button type="button" className="fin-search-box__clear" onClick={() => setQuery("")} aria-label="مسح البحث">
                  <AppIcon name="close" />
                </button>
              ) : null}
            </div>

            {branches.length > 1 ? (
              <select className="fin-branch-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="تصفية حسب الفرع">
                <option value="all">كل الفروع ({branches.length})</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.label}</option>)}
              </select>
            ) : null}

            {activeTab === "transfers" ? (
              <button type="button" className="fin-button fin-button--secondary" onClick={handleExportTransfersCsv} disabled={filteredTransfers.length === 0}>
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredTransfers.length})</span>
              </button>
            ) : (
              <button type="button" className="fin-button fin-button--secondary" onClick={handleExportArchiveCsv} disabled={filteredArchive.length === 0}>
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredArchive.length})</span>
              </button>
            )}
          </div>

          <div className="fin-toolbar__row">
            {activeTab === "transfers" ? (
              <div className="fin-filter-pills" role="group" aria-label="تصفية نوع واتجاه التسليم">
                {ledgerFilters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={ledgerFilter === filter.id}
                    className={`fin-filter-pill${ledgerFilter === filter.id ? " is-active" : ""}`}
                    onClick={() => setLedgerFilter(filter.id)}
                  >
                    <span>{filter.label}</span>
                    <span className="fin-filter-pill__count">{transferCounts[filter.id]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="fin-filter-pills" role="group" aria-label="تصفية حالة التسويات المؤرشفة">
                {settlementArchiveFilters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={archiveFilter === filter.id}
                    className={`fin-filter-pill${archiveFilter === filter.id ? " is-active" : ""}`}
                    onClick={() => setArchiveFilter(filter.id)}
                  >
                    <span>{filter.label}</span>
                    <span className="fin-filter-pill__count">{archiveCounts[filter.id]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div role="tabpanel" id="fin-ledger-panel" aria-labelledby={activeTab === "transfers" ? "fin-ledger-tab-transfers" : "fin-ledger-tab-settlements"}>
          {activeTab === "transfers" ? (
            filteredTransfers.length === 0 ? (
              <div className="fin-empty" role="status">
                {transfers.length === 0
                  ? "لم تُسجَّل حركات تسليم نقدي بعد ضمن الحسابات المتاحة."
                  : "لا توجد حركات تسليم تطابق معايير البحث أو التصفية الحالية."}
              </div>
            ) : (
              <DataTable
                rows={filteredTransfers}
                columns={transferColumns}
                rowKey={(row) => row.id}
                regionLabel="جدول مالي قابل للتمرير"
                regionClassName="fin-table-wrap"
                tableClassName="fin-table"
                caption="سجل الحركات النقدية — مسار الأموال والسندات المرافقة"
              />
            )
          ) : filteredArchive.length === 0 ? (
            <div className="fin-empty" role="status">
              {archivedSettlements.length === 0
                ? "لا توجد تسويات مؤرشفة (معتمدة أو مرفوضة أو ملغاة) بعد."
                : "لا توجد تسويات مؤرشفة تطابق البحث الحالي."}
            </div>
          ) : (
            <DataTable
              rows={filteredArchive}
              columns={settlementArchiveColumns}
              rowKey={(row) => row.id}
              regionLabel="جدول مالي قابل للتمرير"
              regionClassName="fin-table-wrap"
              tableClassName="fin-table"
              caption="طلبات التسوية — مؤشر الفترة والمعدود والفرق عنه والقرار النهائي"
            />
          )}
        </div>
      </div>

      {selectedVoucher ? (
        <div className="fin-print-voucher-portal" aria-hidden="true">
          <HandoverVoucher voucher={selectedVoucher} active />
        </div>
      ) : null}
    </div>
  );
}
