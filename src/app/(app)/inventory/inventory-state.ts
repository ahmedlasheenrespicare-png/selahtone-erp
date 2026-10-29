import type { FieldErrors } from "@/lib/inventory-validation";

export type InventoryActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
  id?: string;
};

export const initialInventoryActionState: InventoryActionState = { status: "idle" };
