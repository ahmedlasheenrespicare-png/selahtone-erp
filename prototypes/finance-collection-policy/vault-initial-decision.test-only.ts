/**
 * Decision-only test sketch; not a sale or a permission boundary. Caller must
 * normalize with the appropriate current parser and authorize actor/branch
 * before replay. For NEW requests only, the destination must be selected under
 * an independently designed coordination protocol in the SAME transaction as
 * all writes. This sketch does not lock, retry, inspect stock or write anything.
 */
import { vaultInitialReplayMatchesTestOnly, type InitialIdentity } from "./vault-initial-identity.test-only";

type Existing = {id:string;createdById:bigint;requestHash:string};
type ReplayDecision = {kind:"replay";id:string}|{kind:"conflict"}|{kind:"new"};

/** Check an existing request before consulting a new destination. */
export function decideInitialReplayTestOnly(existing:Existing|null,actorId:bigint,identity:InitialIdentity):ReplayDecision {
  if (!existing) return {kind:"new"};
  return vaultInitialReplayMatchesTestOnly(existing,actorId,identity) ? {kind:"replay",id:existing.id} : {kind:"conflict"};
}

/**
 * Candidate behavior, not adopted policy: receipt is required for a new
 * vault route and rejected on other routes rather than silently discarded.
 */
export function decideNewInitialReceiptTestOnly(identity:InitialIdentity,destination:"VAULT"|"CUSTODY"|"NON_CASH"):
  {kind:"allowed";requestHash:string}|{kind:"receipt_required"}|{kind:"unexpected_receipt"}|{kind:"route_mismatch"} {
  if ((destination==="NON_CASH") !== (identity.method!=="CASH")) return {kind:"route_mismatch"};
  if (destination==="VAULT") return identity.acknowledged && identity.reviewedHash
    ? {kind:"allowed",requestHash:identity.reviewedHash} : {kind:"receipt_required"};
  if(identity.hasReceipt) return {kind:"unexpected_receipt"};
  return {kind:"allowed",requestHash:identity.baseHash};
}
