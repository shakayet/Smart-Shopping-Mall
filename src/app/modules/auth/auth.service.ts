import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload, Secret } from 'jsonwebtoken';
import config from '../../../config';
import ApiError from '../../../errors/ApiError';
import { emailHelper } from '../../../helpers/emailHelper';
import { jwtHelper } from '../../../helpers/jwtHelper';
import { errorLogger, logger } from '../../../shared/logger';
import { emailTemplate } from '../../../shared/emailTemplate';
import {
  IAuthResetPassword,
  IChangePassword,
  ILoginData,
  IRequestLoginOtp,
  IResendLoginOtp,
  IVerifyEmail,
  IVerifyLoginOtp,
} from '../../../types/auth';
import { USER_ROLES } from '../../../enums/user';
import cryptoToken from '../../../util/cryptoToken';
import generateOTP from '../../../util/generateOTP';
import { ResetToken } from '../resetToken/resetToken.model';
import { User } from '../user/user.model';
import { ILoginOtp } from '../user/user.interface';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds between requests / resends
const OTP_MAX_ATTEMPTS = 6;

const ADMIN_ROLES = new Set([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN]);

const buildAuthTokens = (user: {
  _id: string | { toString(): string };
  role: USER_ROLES;
  email: string;
}) => {
  const accessToken = jwtHelper.createToken(
    {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );
  const refreshToken = jwtHelper.createToken(
    {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
    },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.jwt_refresh_expire_in as string,
  );
  return { accessToken, refreshToken };
};

type IAccountStatus = {
  verified: boolean;
  status: string;
  email: string;
  role: USER_ROLES;
};

function ensureAccountStatus<T extends IAccountStatus>(
  user: T | null | undefined,
  opts: { requireVerified?: boolean; allowUser?: boolean } = {},
): asserts user is T {
  const { requireVerified = true, allowUser = false } = opts;
  if (!user) throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  if (requireVerified && !user.verified) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please verify your account, then try to login again',
    );
  }
  if (user.status === 'ban') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You don’t have permission to access this content. It looks like your account has been deactivated.',
    );
  }
  if (!allowUser && !ADMIN_ROLES.has(user.role)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Password login is restricted to administrators. Please use the passwordless sign-in flow.',
    );
  }
}

const ensurePasswordlessUser = (user: IAccountStatus) => {
  if (ADMIN_ROLES.has(user.role)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Administrators must sign in with email and password.',
    );
  }
};

const hashOtp = async (otp: number | string): Promise<string> =>
  bcrypt.hash(String(otp), Number(config.bcrypt_salt_rounds));

const buildLoginOtpDoc = async (
  plainOtp: number,
  extra?: Partial<Pick<ILoginOtp, 'resentCount' | 'attemptCount'>>,
): Promise<ILoginOtp> => ({
  hashedCode: await hashOtp(plainOtp),
  expireAt: new Date(Date.now() + OTP_TTL_MS),
  generatedAt: new Date(),
  consumed: false,
  consumedAt: undefined,
  attemptCount: extra?.attemptCount ?? 0,
  resentCount: extra?.resentCount ?? 0,
});

const enforceResendCooldown = (otpDoc?: ILoginOtp) => {
  if (!otpDoc || !otpDoc.generatedAt) return;
  const now = Date.now();
  const earliestNext = otpDoc.generatedAt.getTime() + OTP_RESEND_COOLDOWN_MS;
  if (now < earliestNext) {
    const secs = Math.ceil((earliestNext - now) / 1000);
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      `Please wait ${secs}s before requesting a new code.`,
    );
  }
};

// ----------------- PASSWORD LOGIN (ADMIN / SUPER_ADMIN ONLY) -----------------
const loginUserFromDB = async (payload: ILoginData) => {
  const { email, password } = payload;
  const isExistUser = await User.findOne({ email }).select('+password');
  ensureAccountStatus(isExistUser, { allowUser: false });

  if (password) {
    if (
      !isExistUser.password ||
      !(await User.isMatchPassword(password, isExistUser.password))
    ) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is incorrect!');
    }
  }

  logger.info(`[AUTH] Password login successful for admin ${email}`);
  return buildAuthTokens(isExistUser);
};

// ----------------- PASSWORDLESS LOGIN OTP FLOW -----------------
const requestLoginOtpToDB = async (payload: IRequestLoginOtp) => {
  const email = payload.email.toLowerCase().trim();
  let user = await User.findOne({ email }).select('+loginOtp');
  let createdPendingUser = false;

  if (!user) {
    user = await User.create({
      email,
      name: '',
      role: USER_ROLES.USER,
      verified: false,
      status: 'active',
    });
    createdPendingUser = true;
  }

  ensureAccountStatus(user, { requireVerified: false, allowUser: true });
  ensurePasswordlessUser(user);

  enforceResendCooldown(user.loginOtp);

  const plainOtp = generateOTP();
  const otpDoc = await buildLoginOtpDoc(plainOtp, {
    resentCount: user.loginOtp?.resentCount ?? 0,
  });

  await User.findByIdAndUpdate(user._id, { $set: { loginOtp: otpDoc } });

  try {
    const emailData = emailTemplate.loginOtp({
      email: user.email,
      name: user.name,
      otp: plainOtp,
    });
    await emailHelper.sendEmail(emailData);
    logger.info(
      `[AUTH] Passwordless OTP generated & emailed to ${email} (expires ${OTP_TTL_MS / 60000}m)`,
    );
  } catch (err) {
    errorLogger.error(`[AUTH] Failed to send login OTP email to ${email}`, err);
    if (createdPendingUser) {
      await User.deleteOne({ _id: user._id, verified: false });
    }
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to send sign-in code. Please try again later.',
    );
  }

  return {
    message: 'We have sent a one-time sign-in code to your email.',
  };
};

const resendLoginOtpToDB = async (payload: IResendLoginOtp) => {
  const email = payload.email.toLowerCase().trim();
  const user = await User.findOne({ email }).select('+loginOtp');
  if (!user) {
    logger.warn(
      `[AUTH] Resend login OTP requested for non-existent email: ${email}`,
    );
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
    return {
      message:
        'If an account with this email exists, we have sent a new one-time sign-in code.',
    };
  }
  ensureAccountStatus(user, { requireVerified: false, allowUser: true });
  ensurePasswordlessUser(user);
  enforceResendCooldown(user.loginOtp);

  const plainOtp = generateOTP();
  const nextResentCount = (user.loginOtp?.resentCount ?? 0) + 1;
  const otpDoc = await buildLoginOtpDoc(plainOtp, {
    resentCount: nextResentCount,
  });

  await User.findByIdAndUpdate(user._id, { $set: { loginOtp: otpDoc } });

  try {
    const emailData = emailTemplate.loginOtp({
      email: user.email,
      name: user.name,
      otp: plainOtp,
    });
    await emailHelper.sendEmail(emailData);
    logger.info(
      `[AUTH] Resend login OTP emailed to ${email} (resentCount=${nextResentCount})`,
    );
  } catch (err) {
    errorLogger.error(
      `[AUTH] Failed to resend login OTP email to ${email}`,
      err,
    );
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to send sign-in code. Please try again later.',
    );
  }

  return {
    message:
      'If an account with this email exists, we have sent a new one-time sign-in code.',
  };
};

const verifyLoginOtpToDB = async (payload: IVerifyLoginOtp) => {
  const email = payload.email.toLowerCase().trim();
  const { oneTimeCode } = payload;

  const user = await User.findOne({ email }).select('+loginOtp');
  if (!user) {
    logger.warn(
      `[AUTH] Login OTP verify attempted for non-existent email: ${email}`,
    );
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Invalid or expired one-time code. Please request a new code.',
    );
  }
  ensureAccountStatus(user, { requireVerified: false, allowUser: true });
  ensurePasswordlessUser(user);

  const otp = user.loginOtp;
  if (!otp || !otp.hashedCode) {
    logger.warn(
      `[AUTH] Login OTP verify attempted for ${email} with no pending OTP`,
    );
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Invalid or expired one-time code. Please request a new code.',
    );
  }

  // 1) Attempts exhaustion check BEFORE compare (so brute forcing new code per-attempt fails once locked)
  if (otp.attemptCount >= OTP_MAX_ATTEMPTS) {
    logger.warn(
      `[AUTH] Login OTP attempt limit reached for ${email} (attempts=${otp.attemptCount})`,
    );
    // Invalidate the OTP immediately so it can't be reused
    await User.findByIdAndUpdate(user._id, {
      $set: {
        'loginOtp.hashedCode': null,
        'loginOtp.expireAt': new Date(0),
      },
    });
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Too many incorrect attempts. Please request a new sign-in code.',
    );
  }

  // Pre-emptively bump attemptCount (idempotent; re-checks after compare)
  const nextAttempts = otp.attemptCount + 1;

  // 2) Expiration
  if (new Date() > otp.expireAt) {
    await User.findByIdAndUpdate(user._id, {
      $set: {
        'loginOtp.attemptCount': nextAttempts,
      },
    });
    logger.warn(`[AUTH] Login OTP expired for ${email}`);
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'One-time code has expired. Please request a new code.',
    );
  }

  // 3) Single-use
  if (otp.consumed) {
    logger.warn(`[AUTH] Login OTP already consumed for ${email}`);
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This one-time code has already been used. Please request a new code.',
    );
  }

  // 4) Hash match
  const matches = await User.isMatchHashedOtp(oneTimeCode, otp.hashedCode);
  if (!matches) {
    await User.findByIdAndUpdate(user._id, {
      $set: {
        'loginOtp.attemptCount': nextAttempts,
      },
    });
    logger.warn(
      `[AUTH] Login OTP mismatch for ${email} (attempt ${nextAttempts}/${OTP_MAX_ATTEMPTS})`,
    );
    const remaining = OTP_MAX_ATTEMPTS - nextAttempts;
    const suffix =
      remaining > 0
        ? ` You have ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
        : '';
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Incorrect one-time code.${suffix}`,
    );
  }

  // 5) Success — mark OTP consumed immediately
  const consumed = await User.findOneAndUpdate(
    {
      _id: user._id,
      'loginOtp.hashedCode': otp.hashedCode,
      'loginOtp.consumed': false,
      'loginOtp.expireAt': { $gt: new Date() },
    },
    {
    $set: {
      'loginOtp.consumed': true,
      'loginOtp.consumedAt': new Date(),
      'loginOtp.attemptCount': nextAttempts,
      verified: true,
    },
    },
    { new: true },
  );
  if (!consumed) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This one-time code has already been used or expired.',
    );
  }

  logger.info(
    `[AUTH] Passwordless login OTP verified for ${email} (role=${user.role})`,
  );
  return buildAuthTokens(consumed);
};

// ----------------- EXISTING FORGET / RESET / VERIFY-EMAIL ETC -----------------
const forgetPasswordToDB = async (email: string) => {
  const isExistUser = await User.isExistUserByEmail(email);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const otp = generateOTP();
  const value = {
    otp,
    email: isExistUser.email,
  };
  const forgetPassword = emailTemplate.resetPassword(value);
  emailHelper.sendEmail(forgetPassword);

  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };
  await User.findOneAndUpdate({ email }, { $set: { authentication } });
};

const verifyEmailToDB = async (payload: IVerifyEmail) => {
  const { email, oneTimeCode } = payload;
  const isExistUser = await User.findOne({ email }).select('+authentication');
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (!oneTimeCode) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please give the otp, check your email we send a code',
    );
  }

  if (isExistUser.authentication?.oneTimeCode !== oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'You provided wrong otp');
  }

  const date = new Date();
  if (date > isExistUser.authentication?.expireAt) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Otp already expired, Please try again',
    );
  }

  let message;
  let data;

  if (!isExistUser.verified) {
    await User.findOneAndUpdate(
      { _id: isExistUser._id },
      { verified: true, authentication: { oneTimeCode: null, expireAt: null } },
    );
    message = 'Email verify successfully';
  } else {
    await User.findOneAndUpdate(
      { _id: isExistUser._id },
      {
        authentication: {
          isResetPassword: true,
          oneTimeCode: null,
          expireAt: null,
        },
      },
    );

    const createToken = cryptoToken();
    await ResetToken.create({
      user: isExistUser._id,
      tokenHash: crypto.createHash('sha256').update(createToken).digest('hex'),
      expireAt: new Date(Date.now() + 5 * 60000),
    });
    message =
      'Verification Successful: Please securely store and utilize this code for reset password';
    data = createToken;
  }
  return { data, message };
};

const resetPasswordToDB = async (
  token: string,
  payload: IAuthResetPassword,
) => {
  const { newPassword, confirmPassword } = payload;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const isExistToken = await ResetToken.findOneAndDelete({
    tokenHash,
    expireAt: { $gt: new Date() },
  }).select('+tokenHash');
  if (!isExistToken) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized');
  }

  const isExistUser = await User.findById(isExistToken.user).select(
    '+authentication',
  );
  if (!isExistUser?.authentication?.isResetPassword) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "You don't have permission to change the password. Please click again to 'Forgot Password'",
    );
  }

  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "New password and Confirm password doesn't match!",
    );
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const updateData = {
    password: hashPassword,
    authentication: {
      isResetPassword: false,
    },
  };

  await User.findOneAndUpdate({ _id: isExistToken.user }, updateData, {
    new: true,
  });
};

const changePasswordToDB = async (
  user: JwtPayload,
  payload: IChangePassword,
) => {
  const { currentPassword, newPassword, confirmPassword } = payload;
  const isExistUser = await User.findById(user.id).select('+password');
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (
    currentPassword &&
    (!isExistUser.password ||
      !(await User.isMatchPassword(currentPassword, isExistUser.password)))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is incorrect');
  }

  if (currentPassword === newPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please give different password from current password',
    );
  }
  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Password and Confirm password doesn't matched",
    );
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const updateData = {
    password: hashPassword,
  };
  await User.findOneAndUpdate({ _id: user.id }, updateData, { new: true });
};

const resendOtpToDB = async (email: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  const isExistUser = await User.findOne({ email: normalizedEmail });
  if (!isExistUser) {
    // Do not expose whether an email is registered on this public endpoint.
    await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 400));
    return {
      message: 'If an unverified account with this email exists, we have sent a new OTP.',
    };
  }

  if (isExistUser.verified) {
    return {
      message: 'If an unverified account with this email exists, we have sent a new OTP.',
    };
  }

  const otp = generateOTP();
  const values = {
    name: isExistUser.name,
    otp,
    email: isExistUser.email!,
  };

  const resendTemplate = emailTemplate.createAccount(values);
  emailHelper.sendEmail(resendTemplate);

  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };

  await User.findOneAndUpdate(
    { _id: isExistUser._id },
    { $set: { authentication } },
  );

  return {
    message: 'If an unverified account with this email exists, we have sent a new OTP.',
  };
};

const refreshTokenToDB = async (token: string) => {
  let verifiedToken;
  try {
    verifiedToken = jwtHelper.verifyToken(
      token,
      config.jwt.jwt_refresh_secret as Secret,
    );
  } catch (error) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      'Invalid or expired refresh token',
    );
  }

  const { id } = verifiedToken;

  const isExistUser = await User.findById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User doesn't exist!");
  }

  if (isExistUser.status === 'ban') {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      'Your account has been deactivated.',
    );
  }

  if (!isExistUser.verified) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      'Your account is not verified.',
    );
  }

  const accessToken = jwtHelper.createToken(
    {
      id: isExistUser._id.toString(),
      role: isExistUser.role,
      email: isExistUser.email,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );

  return { accessToken };
};

export const AuthService = {
  verifyEmailToDB,
  loginUserFromDB,
  requestLoginOtpToDB,
  resendLoginOtpToDB,
  verifyLoginOtpToDB,
  forgetPasswordToDB,
  resetPasswordToDB,
  changePasswordToDB,
  resendOtpToDB,
  refreshTokenToDB,
};
