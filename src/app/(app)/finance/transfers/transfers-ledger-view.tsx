"use client";

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { downloadCsvFile } from "@/lib/csv-export";
import { formatMoney } from "../format";
import HandoverVoucher, {
  triggerVoucherPrint,
  type HandoverVoucherData,
} from "./handover-voucher";

export type TransferLedgerRow = {
  id: string;
  branchId: string;
  branchName: string;
  fromLabel: string;
  toLabel: string;
  direction: "TO_VAULT" | "TO_CUSTODY";
  amount: string;
  amountFormatted: string;
  settlementId: string | null;
  actorName: string;
  timestampFormatted: string;
  dateKey: string;
};

export type ArchivedSettlementRow = {
  id: string;
  branchId: string;
  branchName: string;
  holderName: string;
  createdAtDate: string;
  resolvedAtFormatted: string;
  expectedAmountFormatted: string;
  countedAmountFormatted: string;
  adjustmentFormatted: string;
  transferSummary: string;
  status: "CONFIRMED" | "REJECTED" | "CANCELLED";
  statusLabel: string;
  resolvedByName: string;
  reasonText: string;
};

type LedgerFilter =
  | "all"
  | "TO_VAULT"
  | "TO_CUSTODY"
  | "DIRECT"
  | "SETTLEMENT";

type ArchiveStatusFilter = "all" | "CONFIRMED" | "REJECTED" | "CANCELLED";

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
  const [activeTab, setActiveTab] = useState<"transfers" | "settlements">(
    "transfers",
  );
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveStatusFilter>("all");
  const [selectedVoucher, setSelectedVoucher] =
    useState<HandoverVoucherData | null>(null);

  const transferCounts = useMemo(() => {
    let toVault = 0;
    let toCustody = 0;
    let direct = 0;
    let settlement = 0;
    for (const r of transfers) {
      if (r.direction === "TO_VAULT") toVault += 1;
      else toCustody += 1;
      if (r.settlementId) settlement += 1;
      else direct += 1;
    }
    return { all: transfers.length, toVault, toCustody, direct, settlement };
  }, [transfers]);

  const filteredTransfers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transfers.filter((r) => {
      if (branchFilter !== "all" && r.branchId !== branchFilter) return false;
      if (ledgerFilter === "TO_VAULT" && r.direction !== "TO_VAULT") return false;
      if (ledgerFilter === "TO_CUSTODY" && r.direction !== "TO_CUSTODY")
        return false;
      if (ledgerFilter === "DIRECT" && r.settlementId !== null) return false;
      if (ledgerFilter === "SETTLEMENT" && r.settlementId === null) return false;
      if (q) {
        const hay =
          `${r.id} ${r.branchName} ${r.fromLabel} ${r.toLabel} ${r.actorName} ${r.settlementId ?? ""} ${r.dateKey}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transfers, query, branchFilter, ledgerFilter]);

  const archiveCounts = useMemo(() => {
    let confirmed = 0;
    let rejected = 0;
    let cancelled = 0;
    for (const s of archivedSettlements) {
      if (s.status === "CONFIRMED") confirmed += 1;
      else if (s.status === "REJECTED") rejected += 1;
      else cancelled += 1;
    }
    return {
      all: archivedSettlements.length,
      confirmed,
      rejected,
      cancelled,
    };
  }, [archivedSettlements]);

  const filteredArchive = useMemo(() => {
    const q = query.trim().toLowerCase();
    return archivedSettlements.filter((s) => {
      if (branchFilter !== "all" && s.branchId !== branchFilter) return false;
      if (archiveFilter !== "all" && s.status !== archiveFilter) return false;
      if (q) {
        const hay =
          `${s.id} ${s.branchName} ${s.holderName} ${s.resolvedByName} ${s.reasonText} ${s.createdAtDate}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
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
      [
        "رقم السند",
        "التوقيت",
        "الفرع",
        "الاتجاه",
        "من (المسلِّم)",
        "إلى (المستلِم)",
        "أصل الحركة",
        "المنفِّذ",
        "المبلغ (ج.م)",
      ],
      filteredTransfers.map((r) => [
        `#${r.id}`,
        r.timestampFormatted,
        r.branchName,
        r.direction === "TO_VAULT" ? "توريد للخزنة" : "تغذية عهدة",
        r.fromLabel,
        r.toLabel,
        r.settlementId ? `تسوية عهدة #${r.settlementId}` : "تسليم مباشر",
        r.actorName,
        r.amountFormatted,
      ]),
    );
  }

  function handleExportArchiveCsv() {
    downloadCsvFile(
      `selahtone-settlements-archive-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "رقم التسوية",
        "تاريخ الطلب",
        "الفرع",
        "الموظف",
        "المتوقع (ج.م)",
        "المعدود (ج.م)",
        "الفرق عن المؤشر (ج.م)",
        "التحويل المنفذ",
        "القرار",
        "متخذ القرار",
        "السبب / البيان",
      ],
      filteredArchive.map((s) => [
        `#${s.id}`,
        s.createdAtDate,
        s.branchName,
        s.holderName,
        s.expectedAmountFormatted,
        s.countedAmountFormatted,
        s.adjustmentFormatted,
        s.transferSummary,
        s.statusLabel,
        s.resolvedByName,
        s.reasonText,
      ]),
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
    window.setTimeout(() => {
      triggerVoucherPrint();
    }, 30);
  }

  return (
    <div className="fin-panel" id="transfers-directory">
      <div className="fin-panel__heading fin-panel__heading--split">
        <div>
          <h2>
            {activeTab === "transfers"
              ? "سجل حركات التسليم والتوريد النقدي"
              : "أرشيف قرارات التسوية السابقة"}
          </h2>
          <p>
            {activeTab === "transfers"
              ? "آخر 100 حركة متاحة حسب رقم التسجيل، مع المنفِّذ وأصل الحركة وإمكانية طباعة السند أو تصدير الصفوف المعروضة. قد لا يشمل السجل كل الحركات."
              : "سجل التسويات المعتمدة والمرفوضة والملغاة مع بيان القرار ومنفّذه."}
          </p>
        </div>

        {canManage ? (
          <div className="fin-filter-pills no-print" role="tablist" aria-label="تبديل السجل الرقابي" onKeyDown={handleLedgerTabKeyDown}>
            <button
              type="button"
              role="tab"
              id="fin-ledger-tab-transfers"
              aria-controls="fin-ledger-panel"
              tabIndex={activeTab === "transfers" ? 0 : -1}
              aria-selected={activeTab === "transfers"}
              className={`fin-filter-pill${activeTab === "transfers" ? " is-active" : ""}`}
              onClick={() => setActiveTab("transfers")}
            >
              <span>حركات التسليم</span>
              <span className="fin-filter-pill__count">{transfers.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="fin-ledger-tab-settlements"
              aria-controls="fin-ledger-panel"
              tabIndex={activeTab === "settlements" ? 0 : -1}
              aria-selected={activeTab === "settlements"}
              className={`fin-filter-pill${activeTab === "settlements" ? " is-active" : ""}`}
              onClick={() => setActiveTab("settlements")}
            >
              <span>أرشيف التسويات</span>
              <span className="fin-filter-pill__count">
                {archivedSettlements.length}
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="fin-panel__body">
        <div className="fin-toolbar no-print" role="region" aria-label="أدوات البحث والتصفية">
          <div className="fin-toolbar__row">
            <div className="fin-search-box">
              <svg
                className="fin-search-box__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="20" y1="20" x2="16.3" y2="16.3" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  activeTab === "transfers"
                    ? "ابحث برقم السند أو الموظف أو المنفّذ أو الفرع…"
                    : "ابحث برقم التسوية أو الموظف أو متخذ القرار…"
                }
                aria-label="بحث في السجل"
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

            {activeTab === "transfers" ? (
              <button
                type="button"
                className="fin-button fin-button--secondary"
                onClick={handleExportTransfersCsv}
                disabled={filteredTransfers.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredTransfers.length})</span>
              </button>
            ) : (
              <button
                type="button"
                className="fin-button fin-button--secondary"
                onClick={handleExportArchiveCsv}
                disabled={filteredArchive.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredArchive.length})</span>
              </button>
            )}
          </div>

          <div className="fin-toolbar__row">
            {activeTab === "transfers" ? (
              <div className="fin-filter-pills" role="group" aria-label="تصفية نوع واتجاه التسليم">
                <button
                  type="button"
                  aria-pressed={ledgerFilter === "all"}
                  className={`fin-filter-pill${ledgerFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setLedgerFilter("all")}
                >
                  <span>الكل</span>
                  <span className="fin-filter-pill__count">{transferCounts.all}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={ledgerFilter === "TO_VAULT"}
                  className={`fin-filter-pill${ledgerFilter === "TO_VAULT" ? " is-active" : ""}`}
                  onClick={() => setLedgerFilter("TO_VAULT")}
                >
                  <span>توريد للخزنة</span>
                  <span className="fin-filter-pill__count">{transferCounts.toVault}</span>
                </button>
                {canManage ? (
                  <button
                    type="button"
                    aria-pressed={ledgerFilter === "TO_CUSTODY"}
                    className={`fin-filter-pill${ledgerFilter === "TO_CUSTODY" ? " is-active" : ""}`}
                    onClick={() => setLedgerFilter("TO_CUSTODY")}
                  >
                    <span>تغذية عهدة</span>
                    <span className="fin-filter-pill__count">{transferCounts.toCustody}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-pressed={ledgerFilter === "DIRECT"}
                  className={`fin-filter-pill${ledgerFilter === "DIRECT" ? " is-active" : ""}`}
                  onClick={() => setLedgerFilter("DIRECT")}
                >
                  <span>تسليم مباشر</span>
                  <span className="fin-filter-pill__count">{transferCounts.direct}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={ledgerFilter === "SETTLEMENT"}
                  className={`fin-filter-pill${ledgerFilter === "SETTLEMENT" ? " is-active" : ""}`}
                  onClick={() => setLedgerFilter("SETTLEMENT")}
                >
                  <span>ناتج عن تسوية</span>
                  <span className="fin-filter-pill__count">{transferCounts.settlement}</span>
                </button>
              </div>
            ) : (
              <div className="fin-filter-pills" role="group" aria-label="تصفية حالة التسويات المؤرشفة">
                <button
                  type="button"
                  aria-pressed={archiveFilter === "all"}
                  className={`fin-filter-pill${archiveFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setArchiveFilter("all")}
                >
                  <span>الكل</span>
                  <span className="fin-filter-pill__count">{archiveCounts.all}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={archiveFilter === "CONFIRMED"}
                  className={`fin-filter-pill${archiveFilter === "CONFIRMED" ? " is-active" : ""}`}
                  onClick={() => setArchiveFilter("CONFIRMED")}
                >
                  <span>معتمدة</span>
                  <span className="fin-filter-pill__count">{archiveCounts.confirmed}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={archiveFilter === "REJECTED"}
                  className={`fin-filter-pill${archiveFilter === "REJECTED" ? " is-active" : ""}`}
                  onClick={() => setArchiveFilter("REJECTED")}
                >
                  <span>مرفوضة</span>
                  <span className="fin-filter-pill__count">{archiveCounts.rejected}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={archiveFilter === "CANCELLED"}
                  className={`fin-filter-pill${archiveFilter === "CANCELLED" ? " is-active" : ""}`}
                  onClick={() => setArchiveFilter("CANCELLED")}
                >
                  <span>مُلغاة</span>
                  <span className="fin-filter-pill__count">{archiveCounts.cancelled}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div role="tabpanel" id="fin-ledger-panel" aria-labelledby={activeTab === "transfers" ? "fin-ledger-tab-transfers" : "fin-ledger-tab-settlements"}>
        {activeTab === "transfers" ? (
          filteredTransfers.length === 0 ? (
            <div className="fin-empty">
              {transfers.length === 0
                ? "لم تُسجَّل حركات تسليم نقدي بعد ضمن الحسابات المتاحة."
                : "لا توجد حركات تسليم تطابق معايير البحث أو التصفية الحالية."}
            </div>
          ) : (
            <div className="fin-table-wrap">
              <table className="fin-table">
                <caption>سجل الحركات النقدية — مسار الأموال والسندات المرافقة</caption>
                <thead>
                  <tr>
                    <th scope="col">رقم السند</th>
                    <th scope="col">التوقيت</th>
                    <th scope="col">الفرع</th>
                    <th scope="col">من (المسلِّم)</th>
                    <th scope="col">إلى (المستلِم)</th>
                    <th scope="col">نوع الحركة</th>
                    <th scope="col">المنفِّذ</th>
                    <th scope="col">المبلغ</th>
                    <th scope="col" className="no-print">سند</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransfers.map((tr) => (
                    <tr key={tr.id}>
                      <td>
                        <bdi dir="ltr">#{tr.id}</bdi>
                      </td>
                      <td>
                        <bdi dir="ltr">{tr.timestampFormatted}</bdi>
                      </td>
                      <td>{tr.branchName}</td>
                      <td>{tr.fromLabel}</td>
                      <td>{tr.toLabel}</td>
                      <td>
                        {tr.settlementId ? (
                          <span className="fin-badge fin-badge--approved">
                            تسوية <bdi dir="ltr">#{tr.settlementId}</bdi>
                          </span>
                        ) : tr.direction === "TO_VAULT" ? (
                          <span className="fin-badge fin-badge--paid">توريد للخزنة</span>
                        ) : (
                          <span className="fin-badge fin-badge--vault">تغذية عهدة</span>
                        )}
                      </td>
                      <td>{tr.actorName}</td>
                      <td>
                        <strong className="fin-money">
                          <bdi dir="ltr">{formatMoney(tr.amount)}</bdi>
                        </strong>
                      </td>
                      <td className="no-print">
                        <button
                          type="button"
                          className="fin-voucher-print-btn"
                          onClick={() => handlePrintRowVoucher(tr)}
                          title={`طباعة سند التسليم الرسمي رقم #${tr.id}`}
                        >
                          <AppIcon name="printer" />
                          <span>طباعة سند</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredArchive.length === 0 ? (
          <div className="fin-empty">
            {archivedSettlements.length === 0
              ? "لا توجد تسويات مؤرشفة (معتمدة أو مرفوضة أو ملغاة) بعد."
              : "لا توجد تسويات مؤرشفة تطابق البحث الحالي."}
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <caption>طلبات التسوية — مؤشر الفترة والمعدود والفرق عنه والقرار النهائي</caption>
              <thead>
                <tr>
                  <th scope="col">رقم الطلب</th>
                  <th scope="col">تاريخ البتّ</th>
                  <th scope="col">الفرع والموظف</th>
                  <th scope="col">مؤشر الفترة</th>
                  <th scope="col">المعدود</th>
                  <th scope="col">الفرق عن المؤشر</th>
                  <th scope="col">التحويل المنفَّذ</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">متّخذ القرار والسبب</th>
                </tr>
              </thead>
              <tbody>
                {filteredArchive.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <bdi dir="ltr">#{s.id}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{s.resolvedAtFormatted}</bdi>
                    </td>
                    <td>
                      <strong>{s.branchName}</strong> · {s.holderName}
                    </td>
                    <td>
                      <bdi dir="ltr">{s.expectedAmountFormatted}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{s.countedAmountFormatted}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{s.adjustmentFormatted}</bdi>
                    </td>
                    <td>{s.transferSummary}</td>
                    <td>
                      <span
                        className={`fin-badge ${
                          s.status === "CONFIRMED"
                            ? "fin-badge--paid"
                            : s.status === "REJECTED"
                              ? "fin-badge--danger"
                              : "fin-badge--closed"
                        }`}
                      >
                        {s.statusLabel}
                      </span>
                    </td>
                    <td>
                      <strong>{s.resolvedByName}</strong>
                      {s.reasonText ? ` — ${s.reasonText}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
