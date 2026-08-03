import express from 'express';

import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import {
  authLimiter,
  otpGenerationLimiter,
  otpVerificationLimiter,
} from '../../middlewares/rateLimiter';
import validateRequest from '../../middlewares/validateRequest';
import { AuthController } from './auth.controller';
import { AuthValidation } from './auth.validation';
const router = express.Router();

// -------------------- ADMIN password login (unchanged behavior — email + password for admins only) --------------------
router.post(
  '/admin/login',
  authLimiter,
  validateRequest(AuthValidation.createLoginZodSchema),
  AuthController.loginAdmin,
);

// App login step 1: email only. A one-time code is sent to the user.
router.post(
  '/login',
  otpGenerationLimiter,
  validateRequest(AuthValidation.createRequestLoginOtpZodSchema),
  AuthController.requestLoginOtp,
);

// -------------------- PASSWORDLESS LOGIN (OTP) for USER role --------------------
router.post(
  '/request-login-otp',
  otpGenerationLimiter,
  validateRequest(AuthValidation.createRequestLoginOtpZodSchema),
  AuthController.requestLoginOtp,
);

router.post(
  '/resend-login-otp',
  otpGenerationLimiter,
  validateRequest(AuthValidation.createResendLoginOtpZodSchema),
  AuthController.resendLoginOtp,
);

router.post(
  '/verify-login-otp',
  otpVerificationLimiter,
  validateRequest(AuthValidation.createVerifyLoginOtpZodSchema),
  AuthController.verifyLoginOtp,
);

// Alias preferred by the app. Keep /verify-login-otp for existing clients.
router.post(
  '/login-otp',
  otpVerificationLimiter,
  validateRequest(AuthValidation.createVerifyLoginOtpZodSchema),
  AuthController.verifyLoginOtp,
);

// -------------------- VERIFY-EMAIL / PASSWORD RECOVERY / CHANGE-PASSWORD --------------------
router.post(
  '/verify-email',
  authLimiter,
  validateRequest(AuthValidation.createVerifyEmailZodSchema),
  AuthController.verifyEmail,
);

router.post(
  '/forget-password',
  authLimiter,
  validateRequest(AuthValidation.createForgetPasswordZodSchema),
  AuthController.forgetPassword,
);

router.post(
  '/reset-password',
  authLimiter,
  validateRequest(AuthValidation.createResetPasswordZodSchema),
  AuthController.resetPassword,
);

router.post(
  '/change-password',
  auth(USER_ROLES.ADMIN, USER_ROLES.USER),
  validateRequest(AuthValidation.createChangePasswordZodSchema),
  AuthController.changePassword,
);

router.post(
  '/resend-otp',
  otpGenerationLimiter,
  validateRequest(AuthValidation.createResendLoginOtpZodSchema),
  AuthController.resendLoginOtp,
);

router.post(
  '/refresh-token',
  validateRequest(AuthValidation.refreshTokenZodSchema),
  AuthController.refreshToken,
);

export const AuthRoutes = router;
