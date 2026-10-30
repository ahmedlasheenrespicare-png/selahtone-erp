/** Test-only domain and SQL port. Never connect this lab to a real database. */
export type FinanceRole = "MANAGER" | "ACCOUNTANT" | "CS_AGENT";
export type AccountKind = "VAULT" | "CUSTODY";
export type Method = "CASH" | "CARD" | "BANK_TRANSFER" | "WALLET";
export type Actor = { id: string; role: FinanceRole; branchId: string | null; status: "ACTIVE" | "SUSPENDED"; mustChangePassword: boolean };
export type AccountScope = { id: string; branchId: string; kind: AccountKind; holderId: string | null };
export type QueryResult<T> = { rows: T[] };
/** Optional test-only category adapter. All methods use the same transaction. */
export type FinanceCategoryRow = Record<string, unknown> & {id:string;name:string;active:boolean;revision:number;snapshot?:string};
export interface FinanceCategoryPort {
  list(): Promise<FinanceCategoryRow[]>;
  lock(id:string): Promise<FinanceCategoryRow>;
  create(name:string,actorId:string,requestId:string): Promise<string>;
  edit(before:FinanceCategoryRow,input:{name:string;active:boolean;expectedSnapshot:string|null},actorId:string): Promise<void>;
}
export interface FinanceTransaction {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<QueryResult<T>>;
  /** Experimental category bridge; omitted in the ordinary finance laboratory. */
  categoryPort?: FinanceCategoryPort;
  /** Optional test bridge: verify duplicated application/lab branch state under the same transaction. */
  verifyBranchState?(branchId: string, active: boolean): Promise<void>;
  /** Mandatory for a pending invoice case: lock and verify the actual lab invoice. */
  verifySaleBranch?(saleId: string, branchId: string): Promise<void>;
}
/** Adapter MUST use a fresh SERIALIZABLE transaction and rollback on all errors. */
export interface FinanceDatabase { serializable<T>(work: (tx: FinanceTransaction) => Promise<T>): Promise<T> }
export class FinanceProblem extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: Record<string, string>) { super(message); this.name = "FinanceProblem"; }
}
export type WriteResult = { id: string; replayed: boolean };
