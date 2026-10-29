import type { FieldErrors } from "@/lib/inventory-validation";

export type SalesActionState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: FieldErrors; id?: string };
export const initialSalesActionState: SalesActionState = { status: "idle" };
