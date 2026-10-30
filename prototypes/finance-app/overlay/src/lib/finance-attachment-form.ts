/** TEST ONLY: parse one fictional upload from the lab server action.
 * The engine independently checks signature, extension, type and authorization. */
import { FinanceProblem } from "../../prototypes/finance-engine/types";
import { MAX_ATTACHMENT_BYTES } from "../../prototypes/finance-engine/attachment-validation";

export async function readFictionalAttachment(data: FormData): Promise<{ name: string; mediaType: string; bytes: Uint8Array }> {
  const files = data.getAll("attachment");
  if (files.length !== 1 || !(files[0] instanceof File) || !files[0].name) throw new FinanceProblem("invalid_attachment", "اختر ملفًا وهميًا واحدًا فقط.");
  const file = files[0];
  // Reject oversize before creating another byte copy. Next's separate
  // request-body limit also bounds the multipart parser for this lab.
  if (file.size > MAX_ATTACHMENT_BYTES) throw new FinanceProblem("invalid_attachment", "الحد الأقصى للملف الوهمي 5 MB.");
  return { name: file.name, mediaType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}
