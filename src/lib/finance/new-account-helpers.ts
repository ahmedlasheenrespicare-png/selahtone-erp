/**
 * دوال نقية مساعدة لصفحة «فتح خزنة أو عهدة» (/finance/accounts)
 * تدعم:
 * - تطبيع الأرقام العربية/الفارسية والتحقق من رصيد البداية غير السالب (بما فيه 0.00)
 * - حاسبة فئات النقد الورقية والمعدنية للجرد الفعلي بدقة القروش (bigint)
 * - مصفوفة تغطية الفروع والموظفين (الخزائن الناقصة، العُهَد المفتوحة، العُهَد المقفلة سابقًا)
 * - تجهيز حمولة البتّ في طلب العهدة بأمان (تحويل تأكيد الجرد إلى boolean)
 */

import { shiftIsoDateDays } from "./new-expense-helpers";

export { shiftIsoDateDays };

export const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 1] as const;
export type CashDenomination = (typeof CASH_DENOMINATIONS)[number];

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeAccountMoneyInput(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const arIdx = ARABIC_INDIC.indexOf(ch);
    if (arIdx !== -1) {
      out += String(arIdx);
      continue;
    }
    const faIdx = EASTERN_ARABIC.indexOf(ch);
    if (faIdx !== -1) {
      out += String(faIdx);
      continue;
    }
    if (ch === "٫") {
      out += ".";
      continue;
    }
    if (ch === "," || ch === "٬" || ch === " " || ch === "\u00a0") {
      continue;
    }
    out += ch;
  }
  return out.trim();
}

/**
 * يحوّل نص رصيد البداية إلى قروش صحيحة غير سالبة (>= 0n، بحد أقصى منزلتين عشريتين و14 رقمًا صحيحًا).
 * يعيد null عند السالب أو النص الفارغ أو الصيغة غير الصالحة.
 */
export function parseNonNegativeMoneyCents(raw: string): bigint | null {
  const clean = normalizeAccountMoneyInput(raw);
  if (!clean || !/^\d{1,14}(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole = "0", frac = ""] = clean.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

/**
 * يحوّل عدد الأوراق النقدية (عدد صحيح غير سالب، يقبل الأرقام العربية) إلى رقم صحيح.
 * الفارغ يعامَل كصفر؛ وأي كسر أو حرف يعيد null.
 */
export function parseBillCount(raw: string | undefined): number | null {
  if (!raw) return 0;
  const clean = normalizeAccountMoneyInput(raw);
  if (!clean) return 0;
  if (!/^\d{1,7}$/.test(clean)) return null;
  return Number(clean);
}

export function centsToAccountInput(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const base =
    frac === 0n
      ? `${whole}.00`
      : `${whole}.${frac.toString().padStart(2, "0")}`;
  return neg ? `-${base}` : base;
}

export type DenominationSummary = {
  valid: boolean;
  totalCents: bigint;
  totalInputString: string;
  totalBillsCount: number;
  nonZeroItems: Array<{ denomination: CashDenomination; count: number; subtotalCents: bigint }>;
  coinsCents: bigint;
};

export function calculateDenominationTotal(
  billCounts: Partial<Record<CashDenomination, string>>,
  coinsRaw = "",
): DenominationSummary {
  let totalCents = 0n;
  let totalBillsCount = 0;
  const nonZeroItems: DenominationSummary["nonZeroItems"] = [];

  for (const denom of CASH_DENOMINATIONS) {
    const parsedCount = parseBillCount(billCounts[denom]);
    if (parsedCount === null) {
      return {
        valid: false,
        totalCents: 0n,
        totalInputString: "0.00",
        totalBillsCount: 0,
        nonZeroItems: [],
        coinsCents: 0n,
      };
    }
    if (parsedCount > 0) {
      const subtotalCents = BigInt(denom) * BigInt(parsedCount) * 100n;
      totalCents += subtotalCents;
      totalBillsCount += parsedCount;
      nonZeroItems.push({
        denomination: denom,
        count: parsedCount,
        subtotalCents,
      });
    }
  }

  let coinsCents = 0n;
  const cleanCoins = normalizeAccountMoneyInput(coinsRaw);
  if (cleanCoins !== "") {
    const parsedCoins = parseNonNegativeMoneyCents(cleanCoins);
    if (parsedCoins === null) {
      return {
        valid: false,
        totalCents: 0n,
        totalInputString: "0.00",
        totalBillsCount: 0,
        nonZeroItems: [],
        coinsCents: 0n,
      };
    }
    coinsCents = parsedCoins;
    totalCents += coinsCents;
  }

  return {
    valid: true,
    totalCents,
    totalInputString: centsToAccountInput(totalCents),
    totalBillsCount,
    nonZeroItems,
    coinsCents,
  };
}

export type CoverageBranchInput = { id: string; name: string; code: string };
export type CoverageStaffInput = { id: string; name: string; branchId: string };
export type CoverageAccountInput = {
  id: string;
  branchId: string;
  kind: "VAULT" | "CUSTODY";
  holderId: string | null;
  balance: string;
  closedAt: string | null;
};

export type BranchCoverageSummary = {
  totalActiveBranches: number;
  openVaultCount: number;
  missingVaultBranches: CoverageBranchInput[];
  totalActiveStaff: number;
  openCustodyCount: number;
  availableStaffCount: number;
  closedCustodyCount: number;
  openVaultBranchIds: string[];
  openCustodyHolderIds: string[];
  closedCustodyHolderIds: string[];
};

export function computeBranchAccountCoverage(
  branches: CoverageBranchInput[],
  staff: CoverageStaffInput[],
  accounts: CoverageAccountInput[],
): BranchCoverageSummary {
  const activeBranchIdSet = new Set(branches.map((b) => b.id));
  const openVaultBranchSet = new Set<string>();
  const openCustodyHolderSet = new Set<string>();
  const closedCustodyHolderSet = new Set<string>();
  let closedCustodyCount = 0;

  for (const acc of accounts) {
    if (acc.kind === "VAULT" && !acc.closedAt) {
      if (activeBranchIdSet.has(acc.branchId)) {
        openVaultBranchSet.add(acc.branchId);
      }
    } else if (acc.kind === "CUSTODY") {
      if (acc.closedAt) {
        closedCustodyCount += 1;
        if (acc.holderId) closedCustodyHolderSet.add(acc.holderId);
      } else if (acc.holderId) {
        openCustodyHolderSet.add(acc.holderId);
      }
    }
  }

  // إن كان للموظف عهدة مفتوحة حاليًا، لا نصنّفه ضمن «عهدة مقفلة فقط»
  for (const openHolderId of openCustodyHolderSet) {
    closedCustodyHolderSet.delete(openHolderId);
  }

  const missingVaultBranches = branches.filter((b) => !openVaultBranchSet.has(b.id));
  const availableStaff = staff.filter((member) => !openCustodyHolderSet.has(member.id));

  return {
    totalActiveBranches: branches.length,
    openVaultCount: openVaultBranchSet.size,
    missingVaultBranches,
    totalActiveStaff: staff.length,
    openCustodyCount: openCustodyHolderSet.size,
    availableStaffCount: availableStaff.length,
    closedCustodyCount,
    openVaultBranchIds: Array.from(openVaultBranchSet),
    openCustodyHolderIds: Array.from(openCustodyHolderSet),
    closedCustodyHolderIds: Array.from(closedCustodyHolderSet),
  };
}

/**
 * يجهّز مدخلات `decideCustodyRequest` بأمان:
 * - عند الموافقة (`APPROVE`): يحوّل `counted === "yes"` إلى `boolean` صريح (`true` أو `false`).
 * - عند الرفض (`REJECT`): لا تُفتح عهدة ولا يُجرى جرد نقدي، فيُمرَّر `counted: true` لتجاوز بوابة الإدخال دون المساس بالمحرك.
 */
export function buildCustodyDecisionPayload(fields: {
  requestId: string;
  requestDbId: string;
  decision: string;
  reason: string;
  openingDate: string;
  countedRaw: string;
}) {
  const decision = fields.decision.trim();
  const counted = decision === "REJECT" ? true : fields.countedRaw === "yes";
  return {
    requestId: fields.requestId,
    requestId2: fields.requestDbId,
    decision,
    reason: fields.reason,
    openingDate: fields.openingDate,
    counted,
  };
}
