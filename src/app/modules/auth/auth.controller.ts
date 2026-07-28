import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AuthService } from './auth.service';
import { JwtPayload } from 'jsonwebtoken';
import ApiError from '../../../errors/ApiError';

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  const { ...verifyData } = req.body;
  const result = await AuthService.verifyEmailToDB(verifyData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result.data,
  });
});

// Admin password-based login (ADMIN | SUPER_ADMIN roles ONLY — enforced in service layer)
const loginAdmin = catchAsync(async (req: Request, res: Response) => {
  const { ...loginData } = req.body;
  const result = await AuthService.loginUserFromDB(loginData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Admin logged in successfully.',
    data: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

// Legacy /login endpoint: route is deprecated — forwards to the same admin-password
// login service (which itself now rejects USER role password attempts).
// Kept for backwards compatibility with old client builds briefly — new clients
// should use /auth/admin/login or the passwordless /auth/request-login-otp flow.
const loginUser = catchAsync(async (req: Request, res: Response) => {
  const { ...loginData } = req.body;
  const result = await AuthService.loginUserFromDB(loginData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User logged in successfully.',
    data: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

// --------------- Passwordless login (OTP) flow for USER role (also works for admins) ---------------
const requestLoginOtp = catchAsync(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await AuthService.requestLoginOtpToDB({ email });

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
  });
});

const resendLoginOtp = catchAsync(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await AuthService.resendLoginOtpToDB({ email });

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
  });
});

const verifyLoginOtp = catchAsync(async (req: Request, res: Response) => {
  const { email, oneTimeCode } = req.body;
  const result = await AuthService.verifyLoginOtpToDB({ email, oneTimeCode });

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Signed in successfully.',
    data: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

const forgetPassword = catchAsync(async (req: Request, res: Response) => {
  const email = req.body.email;
  const result = await AuthService.forgetPasswordToDB(email);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message:
      'Please check your email. We have sent you a one-time passcode (OTP).',
    data: result,
  });
});

const resendOtp = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;
  const result = await AuthService.resendOtpToDB(user.email);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const token = req.headers.authorization;
  const { ...resetData } = req.body;
  const result = await AuthService.resetPasswordToDB(token!, resetData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Your password has been successfully reset.',
    data: result,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload | undefined;
  const { ...passwordData } = req.body;
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }
  await AuthService.changePasswordToDB(user as JwtPayload, passwordData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Your password has been successfully changed',
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const result = await AuthService.refreshTokenToDB(refreshToken);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Access token generated successfully',
    data: result,
  });
});

export const AuthController = {
  verifyEmail,
  loginUser,
  loginAdmin,
  requestLoginOtp,
  resendLoginOtp,
  verifyLoginOtp,
  forgetPassword,
  resetPassword,
  changePassword,
  resendOtp,
  refreshToken,
};
