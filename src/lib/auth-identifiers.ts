import { createHmac } from "node:crypto";

/** بصمات منفصلة للحد من المحاولات والتدقيق دون تخزين البريد في السجل. */
export function authIdentifierHash(email: string, purpose: string, secret: string | Uint8Array): string {
  return createHmac("sha256", secret).update(`${purpose}:${email}`).digest("hex");
}
