import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Secret } from 'jsonwebtoken';
import config from '../../config';
import ApiError from '../../errors/ApiError';
import { jwtHelper } from '../../helpers/jwtHelper';
import { User } from '../modules/user/user.model';

export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization) {
      next();
      return;
    }

    const [scheme, token, ...extraParts] = authorization.trim().split(/\s+/);
    if (scheme !== 'Bearer' || !token || extraParts.length > 0) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized');
    }

    req.user = jwtHelper.verifyToken(
      token,
      config.jwt.jwt_secret as Secret,
    );
    next();
  } catch (error) {
    next(error);
  }
};

const auth =
  (...roles: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tokenWithBearer = req.headers.authorization;
      if (!tokenWithBearer || !tokenWithBearer.startsWith('Bearer')) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized');
      }

      const token = tokenWithBearer.split(' ')[1];

      //verify token
      const verifyUser = jwtHelper.verifyToken(
        token,
        config.jwt.jwt_secret as Secret,
      );
      const account = await User.findById(verifyUser.id)
        .select('role status verified')
        .lean();
      if (
        !account ||
        !account.verified ||
        account.role !== verifyUser.role ||
        account.status === 'suspended' ||
        account.status === 'ban'
      ) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          'Your account is not permitted to access this API',
        );
      }
      //set user to header
      req.user = verifyUser;

      //guard user
      if (roles.length && !roles.includes(verifyUser.role)) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          "You don't have permission to access this api",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export default auth;
