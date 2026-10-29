import { parseOpeningInput, type FieldErrors, type OpeningInput, type OpeningInputRaw, type ValidationResult } from "./inventory-validation";

export type ReceiptInputRaw = OpeningInputRaw & { sourceReference: string };
export type ReceiptInput = OpeningInput & { sourceReference: string | null };

/** Validate a stock receipt without creating supplier invoices or payment records. */
export function parseReceiptInput(raw: ReceiptInputRaw, needsSerials: boolean): ValidationResult<ReceiptInput> {
  const parsed = parseOpeningInput(raw, needsSerials);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  const reference = raw.sourceReference.normalize("NFKC").trim();
  if (reference.length > 180 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(reference)) {
    errors.sourceReference = "مرجع المورد يجب ألا يتجاوز 180 حرفًا أو يحتوي على رموز تحكم.";
  }
  if (!parsed.ok || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { ...parsed.value, sourceReference: reference || null } };
}
