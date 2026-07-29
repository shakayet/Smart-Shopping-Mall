/* eslint-disable @typescript-eslint/consistent-type-definitions, no-undef */
import { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
    }
  }
}
