export type ChangePasswordState = {
  message?: string;
  errors?: { currentPassword?: string; newPassword?: string; confirmPassword?: string };
};

export const initialChangePasswordState: ChangePasswordState = {};
