/** Shared result shape for every finance form action.
 * `details` carries read-only facts the engine returns with a refusal, such as
 * the balance it actually saw, so the screen can be corrected without a reload. */
export type FinanceActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  code?: string;
  details?: Record<string, string>;
  id?: string;
};

export const initialFinanceActionState: FinanceActionState = { status: "idle" };
