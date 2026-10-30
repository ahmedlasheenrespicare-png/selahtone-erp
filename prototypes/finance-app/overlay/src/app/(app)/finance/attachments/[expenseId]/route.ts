/** TEST ONLY: download a fictional file from the disposable laboratory.
 * Do not reuse this endpoint as a production file-storage/security design. */
import { getSession } from "@/lib/auth";
import { scopedFinanceDb } from "@/lib/finance-lab";
import { getExpenseAttachment } from "../../../../../../prototypes/finance-engine/engine";
import { FinanceProblem } from "../../../../../../prototypes/finance-engine/types";

export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};
function reply(status: number) { return new Response(null, { status, headers: privateHeaders }); }

export async function GET(_request: Request, { params }: { params: Promise<{ expenseId: string }> }) {
  const session = await getSession();
  if (!session) return reply(401);
  if (session.role !== "MANAGER" && session.role !== "ACCOUNTANT") return reply(403);
  try {
    // The scoped DB checks the current session identity/role under lock, and
    // the core independently authorizes each lookup before reading any bytes.
    const attachment = await getExpenseAttachment(scopedFinanceDb(session), session.id, (await params).expenseId);
    if (!attachment) return reply(404);
    const extension = attachment.mediaType === "application/pdf" ? "pdf" : attachment.mediaType === "image/png" ? "png" : "jpg";
    return new Response(attachment.bytes as BodyInit, { status: 200, headers: {
      ...privateHeaders,
      "Content-Type": attachment.mediaType,
      "Content-Length": String(attachment.size),
      // A fixed ASCII name avoids header injection; the original is visible
      // only in the authenticated UI, and the browser is told to download.
      "Content-Disposition": `attachment; filename="fictional-attachment.${extension}"`,
    } });
  } catch (error) {
    if (error instanceof FinanceProblem) return reply(error.code === "forbidden" ? 403 : error.code === "invalid_input" ? 404 : 500);
    return reply(500);
  }
}
