"use client";

import { formatMoney } from "../format";

export type HandoverVoucherData = {
  voucherNumber: string;
  branchName: string;
  timestampLabel: string;
  fromLabel: string;
  toLabel: string;
  amount: string;
  originLabel: string;
  actorName: string;
};

export function triggerVoucherPrint(): void {
  if (typeof window === "undefined") return;
  const prev = document.body.dataset.printMode;
  document.body.dataset.printMode = "voucher";
  const cleanup = () => {
    if (prev) {
      document.body.dataset.printMode = prev;
    } else {
      delete document.body.dataset.printMode;
    }
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    window.print();
  }, 40);
}

export default function HandoverVoucher({
  voucher,
  active = false,
}: {
  voucher: HandoverVoucherData;
  active?: boolean;
}) {
  return (
    <section
      className={`fin-handover-voucher${active ? " is-active-voucher" : ""}`}
      aria-label={`سند استلام وتسليم نقدي رقم ${voucher.voucherNumber}`}
      dir="rtl"
    >
      <header className="fin-handover-voucher__head">
        <div>
          <p className="fin-handover-voucher__brand">صلة تون — Selahtone ERP</p>
          <h3 className="fin-handover-voucher__title">سند استلام وتسليم نقدي رسمي</h3>
          <p className="fin-handover-voucher__sub">
            الفرع: <strong>{voucher.branchName}</strong> · نوع العملية:{" "}
            <strong>{voucher.originLabel}</strong>
          </p>
        </div>
        <div className="fin-handover-voucher__meta">
          <span className="fin-handover-voucher__num">
            رقم السند: <bdi dir="ltr">#{voucher.voucherNumber}</bdi>
          </span>
          <span className="fin-handover-voucher__date">
            التاريخ والوقت: <bdi dir="ltr">{voucher.timestampLabel}</bdi>
          </span>
        </div>
      </header>

      <div className="fin-handover-voucher__amount-box">
        <span>المبلغ المسلَّم نقدًا</span>
        <strong>
          <bdi dir="ltr">{formatMoney(voucher.amount)}</bdi> <small>ج.م</small>
        </strong>
      </div>

      <dl className="fin-handover-voucher__grid">
        <div>
          <dt>الطرف المسلِّم (مصدر النقد)</dt>
          <dd>{voucher.fromLabel}</dd>
        </div>
        <div>
          <dt>الطرف المستلِم (وعاء الاستلام)</dt>
          <dd>{voucher.toLabel}</dd>
        </div>
        <div>
          <dt>مسجِّل / معتمد الحركة بالنظام</dt>
          <dd>{voucher.actorName}</dd>
        </div>
        <div>
          <dt>إقرار المطابقة والاستلام الفعلي</dt>
          <dd>تم عدّ النقد وتسليمه واستلامه فعليًا يدًا بيد وفق المبلغ الموضح أعلاه.</dd>
        </div>
      </dl>

      <footer className="fin-handover-voucher__signatures">
        <div className="fin-handover-voucher__sig">
          <span>توقيع المسلِّم</span>
          <div className="fin-handover-voucher__sig-line" />
          <small>{voucher.fromLabel}</small>
        </div>
        <div className="fin-handover-voucher__sig">
          <span>توقيع المستلِم</span>
          <div className="fin-handover-voucher__sig-line" />
          <small>{voucher.toLabel}</small>
        </div>
      </footer>
    </section>
  );
}
