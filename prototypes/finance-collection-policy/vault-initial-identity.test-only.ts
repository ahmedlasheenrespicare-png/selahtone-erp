/**
 * Pure identity experiment for normalized initial sales only. It is not a sale
 * command, authorization check, route selector, receipt or production API.
 * Base hashes mirror the two existing services. A new vault write would require
 * a separate authorization, destination decision and explicit acknowledgement
 * inside the same transaction; this helper cannot enforce any of those.
 */
import { createHash } from "node:crypto";
import type { SaleInput } from "../../src/lib/commerce-validation";
import type { CatalogSaleInput } from "../../src/lib/catalog-validation";

const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
type InitialSale = {kind:"STOCK";input:SaleInput}|{kind:"CATALOG";input:CatalogSaleInput};

export function vaultInitialIdentityTestOnly(actorId:bigint,sale:InitialSale,raw:unknown) {
  const baseHash=hash({actorId:actorId.toString(),...sale.input});
  const obj=typeof raw==="object" && raw!==null && !Array.isArray(raw) ? raw as Record<string,unknown> : {};
  const hasReceipt=Object.hasOwn(obj,"vaultReceived");
  const acknowledged=hasReceipt && obj.vaultReceived===true && sale.input.method==="CASH";
  const reviewedHash=acknowledged ? hash({actorId:actorId.toString(),...sale.input,vaultInitialVersion:1,vaultInitialKind:sale.kind,vaultReceived:true}):null;
  return {baseHash,hasReceipt,acknowledged,reviewedHash,method:sale.input.method};
}

export type InitialIdentity = ReturnType<typeof vaultInitialIdentityTestOnly>;

/** Compare request identity only, never infer authorization or physical receipt. */
export function vaultInitialReplayMatchesTestOnly(existing:{createdById:bigint;requestHash:string},actorId:bigint,identity:ReturnType<typeof vaultInitialIdentityTestOnly>):boolean {
  if(existing.createdById!==actorId) return false;
  const submitted=identity.hasReceipt ? identity.reviewedHash : identity.baseHash;
  return submitted!==null && existing.requestHash.trim()===submitted;
}
