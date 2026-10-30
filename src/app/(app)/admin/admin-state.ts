/** Shared result shape for every branch/user form action on the admin screen. */
export type AdminActionState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export const initialAdminActionState: AdminActionState = { status: "idle" };
