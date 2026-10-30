/** EXPERIMENTAL, TEST-ONLY chunk protocol. It does not persist files, authorize
 * requests, talk to Neon, perform CSRF checks, or supply an atomic state
 * machine. Do not wire it into the deployable application as-is. */
import { createHash } from "node:crypto";
import { inspectAttachment, inspectAttachmentMetadata, MAX_ATTACHMENT_BYTES, type AttachmentMetadata } from "../finance-engine/attachment-validation";
import { FinanceProblem } from "../finance-engine/types";

// Ten requests cover the user's 5,000,000-byte maximum. Each body remains
// comfortably below Netlify's buffered binary request/response payload limit.
export const CHUNK_BYTES = 512_000;
const MAX_CHUNK_READ_MS = 10_000;
export type ChunkPlan = { index: number; offset: number; length: number };
export type VerifiedChunks = { metadata: AttachmentMetadata; sha256: string; chunkHashes: string[]; bytes: Uint8Array };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function problem(): never { throw new FinanceProblem("invalid_attachment", "تعذر التحقق من أجزاء المرفق."); }
function checkedSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 5 || value > MAX_ATTACHMENT_BYTES) return problem();
  return value;
}

export function planChunks(sizeRaw: unknown): ChunkPlan[] {
  const size = checkedSize(sizeRaw), count = Math.ceil(size / CHUNK_BYTES);
  return Array.from({ length: count }, (_, index) => ({ index, offset: index * CHUNK_BYTES, length: Math.min(CHUNK_BYTES, size - index * CHUNK_BYTES) }));
}
function oneChunk(size: unknown, index: unknown): ChunkPlan {
  const plan = planChunks(size);
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= plan.length) return problem();
  return plan[index];
}

/** Fail early for a hostile request, but never trust Content-Length alone.
 * Read only the exact expected number of bytes; reject extra/short streams. */
export async function readBoundedChunk(request: Request, size: unknown, index: unknown, timeoutMs = MAX_CHUNK_READ_MS): Promise<Uint8Array> {
  const expected = oneChunk(size, index).length;
  if ((request.headers.get("content-type") ?? "").trim().toLowerCase() !== "application/octet-stream") return problem();
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.trim().toLowerCase() !== "identity") return problem();
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d{1,8}$/.test(contentLength) || Number(contentLength) !== expected)) return problem();
  if (!request.body || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_CHUNK_READ_MS) return problem();
  const reader = request.body.getReader(), bytes = new Uint8Array(expected);
  let received = 0, complete = false, timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("chunk read timed out")), timeoutMs); });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array) || received + value.byteLength > expected) return problem();
      // One bounded allocation, even when the sender emits many tiny chunks.
      bytes.set(value, received); received += value.byteLength;
    }
    if (received !== expected) return problem();
    complete = true;
    return bytes;
  } catch {
    return problem();
  } finally {
    if (timer) clearTimeout(timer);
    // An uncooperative stream's cancel promise may never resolve; do not wait.
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Verify all chunks, independent of arrival order. The returned buffer is
 * a new snapshot and is the only body the future server should persist. */
export function verifyUpload(name: unknown, claimedType: unknown, size: unknown, chunks: Array<{ index: number; bytes: Uint8Array }>): VerifiedChunks {
  const metadata = inspectAttachmentMetadata(name, claimedType, size);
  const plan = planChunks(metadata.size);
  if (!Array.isArray(chunks) || chunks.length !== plan.length) return problem();
  const ordered: Array<Uint8Array | undefined> = Array.from({ length: plan.length });
  for (const chunk of chunks) {
    if (!chunk || !(chunk.bytes instanceof Uint8Array)) return problem();
    const expected = oneChunk(metadata.size, chunk.index);
    if (ordered[expected.index] || chunk.bytes.byteLength !== expected.length) return problem();
    ordered[expected.index] = new Uint8Array(chunk.bytes);
  }
  if (ordered.some(bytes => bytes === undefined)) return problem();
  const orderedBytes = ordered as Uint8Array[];
  const bytes = new Uint8Array(Buffer.concat(orderedBytes, metadata.size));
  const inspected = inspectAttachment(metadata.filename, metadata.mediaType, bytes);
  return { metadata: inspected, sha256: digest(bytes), chunkHashes: orderedBytes.map(digest), bytes };
}

/** A future download route should authorize each part and check it against
 * persisted server-computed hashes before returning the bytes. */
export function verifyDownloadChunk(size: unknown, index: unknown, expectedHashes: unknown, bytes: unknown): Uint8Array {
  const plan = planChunks(size), expected = oneChunk(size, index);
  if (!Array.isArray(expectedHashes) || expectedHashes.length !== plan.length ||
      expectedHashes.some(hash => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) ||
      !(bytes instanceof Uint8Array) || bytes.byteLength !== expected.length || digest(bytes) !== expectedHashes[expected.index]) return problem();
  return new Uint8Array(bytes);
}
