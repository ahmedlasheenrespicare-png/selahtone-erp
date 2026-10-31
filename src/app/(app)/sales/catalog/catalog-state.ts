import type { FieldErrors } from "@/lib/inventory-validation";

export type CatalogActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
};

export const initialCatalogActionState: CatalogActionState = { status: "idle" };
