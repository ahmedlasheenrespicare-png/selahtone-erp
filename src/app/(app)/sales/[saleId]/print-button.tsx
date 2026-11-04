"use client";

import { AppIcon } from "@/components/app-icon";

type PrintButtonProps = {
  invoiceCode?: string;
  customerName?: string;
  customerPhone?: string;
  branchName?: string;
  netTotalFormatted?: string;
  paidFormatted?: string;
  dueFormatted?: string;
  hasDue?: boolean;
};

function normalizeWhatsAppPhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 9) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("01") && digits.length === 11) return `2${digits}`;
  if (digits.startsWith("1") && digits.length === 10) return `20${digits}`;
  return digits;
}

export default function PrintButton({
  invoiceCode,
  customerName,
  customerPhone,
  branchName,
  netTotalFormatted,
  paidFormatted,
  dueFormatted,
  hasDue,
}: PrintButtonProps) {
  function printWithMode(mode: "a4" | "thermal"): void {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    root.dataset.printMode = mode;
    const cleanup = () => {
      delete root.dataset.printMode;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  const waPhone = normalizeWhatsAppPhone(customerPhone);
  const waMessage = invoiceCode
    ? [
        `أهلًا ${customerName ?? ""}،`,
        `إيصال صلة تون للخدمات السمعية (${branchName ?? "الفرع"}) — رقم ${invoiceCode}:`,
        `• صافي الفاتورة: ${netTotalFormatted ?? "0.00"} ج.م`,
        `• المسدّد: ${paidFormatted ?? "0.00"} ج.م`,
        hasDue
          ? `• المتبقي للسداد: ${dueFormatted ?? "0.00"} ج.م`
          : "• الحالة: مسدّدة بالكامل، شكرًا لثقتكم.",
      ].join("\n")
    : "";
  const waHref = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`
    : null;

  return (
    <div className="sale-detail-actions no-print">
      <button
        type="button"
        className="inv-button inv-button--secondary"
        onClick={() => printWithMode("a4")}
        title="طباعة الفاتورة بحجم A4"
      >
        <AppIcon name="printer" />
        <span>طباعة A4</span>
      </button>
      <button
        type="button"
        className="inv-button inv-button--secondary"
        onClick={() => printWithMode("thermal")}
        title="طباعة إيصال كاشير حراري 80mm"
      >
        <AppIcon name="receipt" />
        <span>إيصال 80mm</span>
      </button>
      {waHref ? (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className={`inv-button ${hasDue ? "" : "inv-button--secondary"}`}
          title="مشاركة ملخص الفاتورة عبر واتساب"
        >
          <AppIcon name="share" />
          <span>{hasDue ? "تذكير واتساب بالمتبقي" : "إرسال واتساب"}</span>
        </a>
      ) : null}
    </div>
  );
}
