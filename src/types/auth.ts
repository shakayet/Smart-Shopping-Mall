export type IVerifyEmail = {
  email: string;
  oneTimeCode: number;
};

export type ILoginData = {
  email: string;
  password: string;
};

export type IRequestLoginOtp = {
  email: string;
};

export type IResendLoginOtp = {
  email: string;
};

export type IVerifyLoginOtp = {
  email: string;
  oneTimeCode: number;
};

export type IAuthResetPassword = {
  newPassword: string;
  confirmPassword: string;
};

export type IChangePassword = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};
