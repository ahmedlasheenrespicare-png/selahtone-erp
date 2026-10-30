import { FinanceProblem } from "./types";

/** Metadata/signature check only. This does not scan or store files. */
export const MAX_ATTACHMENT_BYTES = 5_000_000;
export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AttachmentType = typeof ATTACHMENT_TYPES[number];
export type AttachmentMetadata = { filename: string; mediaType: AttachmentType; size: number };

/** Validate before allocating an upload; the bytes must still be verified later. */
export function inspectAttachmentMetadata(name: unknown, claimedType: unknown, size: unknown): AttachmentMetadata {
  if (typeof name !== "string") throw new FinanceProblem("invalid_attachment", "اسم المرفق غير صالح.");
  const filename = name.normalize("NFKC").trim();
  if (!filename || filename.length > 120 || /[\\/\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(filename)) throw new FinanceProblem("invalid_attachment", "اسم المرفق غير صالح.");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 5 || size > MAX_ATTACHMENT_BYTES) throw new FinanceProblem("invalid_attachment", "حجم المرفق يجب ألا يتجاوز 5 ميجابايت.");
  if (!ATTACHMENT_TYPES.includes(claimedType as AttachmentType)) throw new FinanceProblem("invalid_attachment", "المسموح ملف PDF أو صورة JPG أو PNG فقط.");
  const mediaType = claimedType as AttachmentType;
  const expectedExtension = mediaType === "application/pdf" ? /\.pdf$/i : mediaType === "image/jpeg" ? /\.jpe?g$/i : /\.png$/i;
  if (!expectedExtension.test(filename)) throw new FinanceProblem("invalid_attachment", "نوع المرفق أو امتداده لا يطابق محتواه.");
  return { filename, mediaType, size };
}

export function inspectAttachment(name: unknown, claimedType: unknown, bytes: unknown): AttachmentMetadata {
  if (!(bytes instanceof Uint8Array)) throw new FinanceProblem("invalid_attachment", "حجم المرفق يجب ألا يتجاوز 5 ميجابايت.");
  const metadata = inspectAttachmentMetadata(name, claimedType, bytes.byteLength);
  const signature = metadata.mediaType === "application/pdf" ? [0x25, 0x50, 0x44, 0x46, 0x2d] : metadata.mediaType === "image/jpeg" ? [0xff, 0xd8, 0xff] : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < signature.length || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new FinanceProblem("invalid_attachment", "نوع المرفق أو امتداده لا يطابق محتواه.");
  }
  return metadata;
}
