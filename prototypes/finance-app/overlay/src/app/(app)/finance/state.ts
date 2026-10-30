export type FinanceActionState = { status: "idle" | "error" | "success"; message: string };
export const initialFinanceState: FinanceActionState = { status: "idle", message: "" };
