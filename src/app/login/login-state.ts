export type LoginFormState = {
  message?: string;
  errors?: { email?: string; password?: string };
};

export const initialLoginState: LoginFormState = {};
