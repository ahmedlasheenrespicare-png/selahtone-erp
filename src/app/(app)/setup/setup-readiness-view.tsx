"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { downloadCsvFile } from "@/lib/csv-export";
import { purgeInactiveSessionsAction } from "../admin/actions";
import { initialAdminActionState } from "../admin/admin-state";
import { createBranchReadinessColumns, readinessCheckColumns } from "./setup-readiness-tables-metadata";
import type { BranchReadinessRow, CheckAxis, CheckSeverity, ReadinessCheckItem } from "./setup-readiness-tables-metadata";
export type { BranchReadinessRow, CheckAxis, CheckSeverity, ReadinessCheckItem } from "./setup-readiness-tables-metadata";

export type SafeEnvFlagItem = {
  key: string;
  title: string;
  valueLabel: string;
  status: CheckSeverity;
  statusLabel: string;
  hint: string;
};

type SetupTab = "checks" | "branches" | "environment";
type StatusFilter = "ALL" | "ISSUES" | "OK";

type Props = {
  isManager: boolean;
  financeOn: boolean;
  checks: ReadinessCheckItem[];
  branches: BranchReadinessRow[];
  envItems: SafeEnvFlagItem[];
  expiredSessionCount: number;
  checkedAtLabel: string;
};

export default function SetupReadinessView({
  isManager,
  financeOn,
  checks,
  branches,
  envItems,
  expiredSessionCount,
  checkedAtLabel,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<SetupTab>("checks");
  const [query, setQuery] = useState("");
  const [axisFilter, setAxisFilter] = useState<"ALL" | CheckAxis>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const [refreshPending, startRefresh] = useTransition();
  const [purgePending, startPurge] = useTransition();
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  const branchReadinessColumns = useMemo(() => createBranchReadinessColumns(financeOn), [financeOn]);

  const [probeState, setProbeState] = useState<{
    loading: boolean;
    ok?: boolean;
    httpMs?: number;
    dbMs?: number;
    error?: string;
  }>({ loading: false });

  const counts = useMemo(() => {
    let ok = 0;
    let issues = 0;
    for (const c of checks) {
      if (c.severity === "ok") ok += 1;
      else issues += 1;
    }
    return { all: checks.length, ok, issues };
  }, [checks]);

  const filteredChecks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return checks.filter((c) => {
      if (axisFilter !== "ALL" && c.axis !== axisFilter) return false;
      if (statusFilter === "OK" && c.severity !== "ok") return false;
      if (statusFilter === "ISSUES" && c.severity === "ok") return false;
      if (q) {
        const hay = `${c.label} ${c.axisLabel} ${c.detail} ${c.statusLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [checks, query, axisFilter, statusFilter]);

  function handleLiveRefresh() {
    startRefresh(() => {
      router.refresh();
    });
  }

  function handlePurgeSessions() {
    if (!isManager || purgePending) return;
    startPurge(async () => {
      const res = await purgeInactiveSessionsAction(initialAdminActionState);
      setPurgeMsg(res.message ?? null);
      router.refresh();
    });
  }

  async function handleRunHealthProbe() {
    setProbeState({ loading: true });
    const t0 = performance.now();
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const httpMs = Math.round(performance.now() - t0);
      const data = (await res.json()) as {
        status?: string;
        db?: { connected?: boolean; latencyMs?: number };
        message?: string;
      };
      if (res.ok && data.status === "ok") {
        setProbeState({
          loading: false,
          ok: true,
          httpMs,
          dbMs: data.db?.latencyMs,
        });
      } else {
        setProbeState({
          loading: false,
          ok: false,
          httpMs,
          error: data.message ?? `HTTP ${res.status}`,
        });
      }
    } catch {
      setProbeState({
        loading: false,
        ok: false,
        error: "تعذّر الوصول إلى نقطة /api/health",
      });
    }
  }

  function exportChecksCsv() {
    downloadCsvFile(
      `selahtone-readiness-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      ["#", "المحور", "بند الفحص", "الحالة", "التفصيل الفعلي", "توقيت الفحص"],
      filteredChecks.map((c, idx) => [
        String(idx + 1),
        c.axisLabel,
        c.label,
        c.statusLabel,
        c.detail,
        checkedAtLabel,
      ]),
    );
  }

  function exportBranchesCsv() {
    downloadCsvFile(
      `selahtone-branch-readiness-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "الفرع",
        "الكود",
        "المدينة",
        "بادئة الفواتير",
        "المستودعات",
        "الموظفون النشطون",
        "خزنة الفرع",
        "الحالة التشغيلية",
        "حكم الجاهزية",
      ],
      branches.map((b) => [
        b.nameAr,
        b.code,
        b.city ?? "—",
        b.invoicePrefix,
        b.warehouseCodes || "لا يوجد",
        `${b.activeStaffCount}/${b.totalStaffCount}`,
        financeOn ? (b.hasOpenVault ? "مفتوحة" : "غير مفتوحة") : "—",
        b.isActive ? "نشط" : "موقوف",
        b.verdictLabel,
      ]),
    );
  }

  function pillClass(sev: CheckSeverity): string {
    if (sev === "ok") return "setup-pill setup-pill--ok";
    if (sev === "warn") return "setup-pill setup-pill--warn";
    return "setup-pill setup-pill--err";
  }

  return (
    <section id="readiness-hub" className="setup-hub">
      <div className="setup-main-tabs no-print" role="tablist" aria-label="أقسام الجاهزية والأمان">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "checks"}
          className={`setup-main-tab${tab === "checks" ? " is-active" : ""}`}
          onClick={() => setTab("checks")}
        >
          <AppIcon name="shield" />
          <span>قائمة الفحوصات الحيّة</span>
          <span className="setup-main-tab__count">{checks.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === "branches"}
          className={`setup-main-tab${tab === "branches" ? " is-active" : ""}`}
          onClick={() => setTab("branches")}
        >
          <AppIcon name="branch" />
          <span>مصفوفة جاهزية الفروع</span>
          <span className="setup-main-tab__count">{branches.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === "environment"}
          className={`setup-main-tab${tab === "environment" ? " is-active" : ""}`}
          onClick={() => setTab("environment")}
        >
          <AppIcon name="settings" />
          <span>بيئة التشغيل والوحدات</span>
          <span className="setup-main-tab__count">{envItems.length}</span>
        </button>
      </div>

      {/* ========================= التبويب ١: الفحوصات الحيّة ========================= */}
      {tab === "checks" ? (
        <div className="dashboard-panel">
          <div className="dashboard-panel__heading setup-panel-head-split">
            <div>
              <p className="dashboard-panel__eyebrow">تشخيص مباشر من القاعدة</p>
              <h2>قائمة التحقق من الجاهزية والأمان ({filteredChecks.length})</h2>
              <p>
                آخر فحص حيّ: <bdi dir="ltr">{checkedAtLabel}</bdi> — كل صف يمثّل قراءة فعلية من قاعدة البيانات ومحركات النظام.
              </p>
            </div>

            <div className="setup-head-actions no-print">
              {isManager && expiredSessionCount > 0 ? (
                <button
                  type="button"
                  className="setup-btn"
                  onClick={handlePurgeSessions}
                  disabled={purgePending}
                >
                  <AppIcon name="lock" />
                  <span>
                    {purgePending
                      ? "جارٍ التطهير…"
                      : `تطهير المنتهية (${expiredSessionCount})`}
                  </span>
                </button>
              ) : null}

              <button
                type="button"
                className="setup-btn"
                onClick={exportChecksCsv}
                disabled={filteredChecks.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredChecks.length})</span>
              </button>

              <button
                type="button"
                className="setup-btn setup-btn--primary"
                onClick={handleLiveRefresh}
                disabled={refreshPending}
              >
                <AppIcon name="check" />
                <span>{refreshPending ? "جارٍ إعادة الفحص…" : "إعادة الفحص الآن"}</span>
              </button>
            </div>
          </div>

          {purgeMsg ? (
            <div style={{ padding: "0 20px 12px" }} className="no-print">
              <div className="alert alert-ok" role="status">
                {purgeMsg}
              </div>
            </div>
          ) : null}

          <div className="setup-toolbar no-print" role="region" aria-label="تصفية الفحوصات">
            <div className="admin-filter-bar">
              <input
                type="search"
                className="admin-filter-bar__search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث باسم الفحص أو المحور أو النتيجة…"
                aria-label="بحث في قائمة الفحوصات"
              />
              <select
                value={axisFilter}
                onChange={(e) => setAxisFilter(e.target.value as "ALL" | CheckAxis)}
                aria-label="تصفية حسب المحور"
              >
                <option value="ALL">كل المحاور الأربعة</option>
                <option value="INFRA">١. البنية وقاعدة البيانات</option>
                <option value="SECURITY">٢. الأمان والهوية والجلسات</option>
                <option value="COMMERCE">٣. المبيعات والضرائب</option>
                <option value="FINANCE">٤. المالية والخزينة</option>
              </select>
            </div>

            <div className="setup-chip-bar" role="tablist" aria-label="نتيجة الفحص">
              <button
                type="button"
                className={`setup-chip${statusFilter === "ALL" ? " is-active" : ""}`}
                onClick={() => setStatusFilter("ALL")}
              >
                الكل ({counts.all})
              </button>
              <button
                type="button"
                className={`setup-chip${statusFilter === "OK" ? " is-active" : ""}`}
                onClick={() => setStatusFilter("OK")}
              >
                سليم ومكتمل ({counts.ok})
              </button>
              <button
                type="button"
                className={`setup-chip${statusFilter === "ISSUES" ? " is-active" : ""}`}
                onClick={() => setStatusFilter("ISSUES")}
              >
                تحذيرات أو نواقص ({counts.issues})
              </button>
            </div>
          </div>

          <DataTable rows={filteredChecks} columns={readinessCheckColumns} rowKey={(row) => row.id}
            regionLabel="جدول فحوصات الجاهزية" regionClassName="dashboard-table-wrap" tableClassName="dashboard-table"
            emptyState={<span style={{ display: "block", textAlign: "center", padding: "24px 12px" }}>لا توجد بنود فحص تطابق التصفية الحالية.</span>} />
        </div>
      ) : null}

      {/* ========================= التبويب ٢: مصفوفة جاهزية الفروع ========================= */}
      {tab === "branches" ? (
        <div className="dashboard-panel">
          <div className="dashboard-panel__heading setup-panel-head-split">
            <div>
              <p className="dashboard-panel__eyebrow">فحص تشغيلي لكل فرع</p>
              <h2>مصفوفة جاهزية الفروع ({branches.length})</h2>
              <p>
                يتحقق من استكمال أركان التشغيل لكل فرع: المستودع الافتراضي، بادئة الفواتير، الموظفون النشطون، وخزنة الفرع النقدية.
              </p>
            </div>
            <div className="setup-head-actions no-print">
              <button
                type="button"
                className="setup-btn"
                onClick={exportBranchesCsv}
                disabled={branches.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير المصفوفة CSV</span>
              </button>
              <Link className="setup-btn" href="/admin">
                <AppIcon name="branch" />
                <span>إدارة الفروع والمستخدمين</span>
              </Link>
            </div>
          </div>

          <DataTable rows={branches} columns={branchReadinessColumns} rowKey={(row) => row.id}
            regionLabel="جدول مصفوفة الفروع" regionClassName="dashboard-table-wrap" tableClassName="dashboard-table" />
        </div>
      ) : null}

      {/* ========================= التبويب ٣: بيئة التشغيل والوحدات ========================= */}
      {tab === "environment" ? (
        <div className="dashboard-panel">
          <div className="dashboard-panel__heading setup-panel-head-split">
            <div>
              <p className="dashboard-panel__eyebrow">إعدادات التشغيل الآمنة</p>
              <h2>حالة الوحدات ومتغيرات البيئة ونقطة المراقبة</h2>
              <p>
                يعرض حالة التفعيل وصلاحية المفاتيح دون كشف أي قيم سرية أو عناوين اتصال.
              </p>
            </div>
          </div>

          <div className="setup-probe-box no-print">
            <div>
              <strong>مسبار المراقبة الخارجية (`/api/health`)</strong>
              <p className="setup-subtext" style={{ margin: "3px 0 0" }}>
                {probeState.ok === undefined
                  ? "اختبر نقطة فحص الصحة الحية للتحقق من زمن استجابة HTTP وقاعدة البيانات كما يراها مراقب الخادم."
                  : probeState.ok
                    ? `استجابة سليمة (200 OK) · زمن HTTP الكلي: ${probeState.httpMs} ms · زمن القاعدة: ${probeState.dbMs ?? "—"} ms`
                    : `تنبيه: ${probeState.error}`}
              </p>
            </div>
            <button
              type="button"
              className="setup-btn setup-btn--primary"
              onClick={handleRunHealthProbe}
              disabled={probeState.loading}
            >
              <AppIcon name="shield" />
              <span>
                {probeState.loading ? "جارٍ اختبار /api/health…" : "اختبار /api/health الآن"}
              </span>
            </button>
          </div>

          <div className="setup-env-grid">
            {envItems.map((env) => (
              <article key={env.key} className="setup-env-card">
                <div className="setup-env-card__head">
                  <span className="setup-env-card__key" dir="ltr">
                    {env.key}
                  </span>
                  <span className={pillClass(env.status)}>{env.statusLabel}</span>
                </div>
                <strong>{env.title}: {env.valueLabel}</strong>
                <span className="setup-subtext">{env.hint}</span>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
