import crypto from 'crypto';
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload, Secret } from 'jsonwebtoken';
import config from '../../../config';
import ApiError from '../../../errors/ApiError';
import { UserService } from '../user/user.service';
import { jwtHelper } from '../../../helpers/jwtHelper';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { User } from '../user/user.model';
import { OAuthCode } from './oauthCode.model';

const hashCode = (code: string) =>
  crypto.createHash('sha256').update(code).digest('hex');

const buildTokens = (user: { _id: { toString(): string }; role: string; email: string }) => ({
  accessToken: jwtHelper.createToken(
    { id: user._id.toString(), role: user.role, email: user.email },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in,
  ),
  refreshToken: jwtHelper.createToken(
    { id: user._id.toString(), role: user.role, email: user.email },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.jwt_refresh_expire_in,
  ),
});

const googleCallback = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as
    | { _id: { toString(): string }; role: string; email: string }
    | undefined;
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication failed');
  }

  const code = crypto.randomBytes(32).toString('base64url');
  await OAuthCode.create({
    codeHash: hashCode(code),
    user: user._id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  req.logout(() => undefined);
  req.session.destroy(() => undefined);

  const callback = new URL(config.oauth.frontendCallbackURL);
  callback.searchParams.set('code', code);
  return res.redirect(callback.toString());
});

const exchangeCode = catchAsync(async (req: Request, res: Response) => {
  const code = typeof req.body.code === 'string' ? req.body.code : '';
  const grant = await OAuthCode.findOneAndDelete({
    codeHash: hashCode(code),
    expiresAt: { $gt: new Date() },
  });
  if (!grant) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired OAuth code');
  }

  const user = await User.findById(grant.user);
  if (!user || user.status === 'ban' || !user.verified) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Account is not available');
  }

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'OAuth sign-in completed',
    data: buildTokens(user),
  });
});

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getUserProfileFromDB(
    req.user as JwtPayload,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User profile retrieved successfully',
    data: result,
  });
});

const getOAuthStatus = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'OAuth provider status retrieved',
    data: { google: { configured: config.oauth.enabled, name: 'Google' } },
  });
});

export const OAuthController = {
  googleCallback,
  exchangeCode,
  getProfile,
  getOAuthStatus,
};
