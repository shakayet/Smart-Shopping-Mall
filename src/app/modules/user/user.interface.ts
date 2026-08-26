/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-vars */
import { Model } from 'mongoose';
import { USER_ROLES } from '../../../enums/user';

export type IAuthentication = {
  isResetPassword: boolean;
  oneTimeCode: number;
  expireAt: Date;
};

export type ILoginOtp = {
  hashedCode: string;
  expireAt: Date;
  generatedAt: Date;
  consumed: boolean;
  consumedAt?: Date;
  attemptCount: number;
  resentCount: number;
};

export type IUser = {
  name: string;
  role: USER_ROLES;
  contact?: string;
  phone?: string;
  email: string;
  password?: string;
  location?: string;
  country?: string;
  image?: string;
  avatar?: string;
  provider?: 'local' | 'google';
  providerId?: string;
  status: 'active' | 'restricted' | 'suspended' | 'ban';
  sellerStrikes: number;
  missedCollections: number;
  buyerUnjustifiedRejections: number;
  statusReason?: string;
  verified: boolean;
  authentication?: IAuthentication;
  loginOtp?: ILoginOtp;
  stripeAccountId?: string;
  stripeCustomerId?: string;
};

export type UserModal = {
  isExistUserById(id: string): any;
  isExistUserByEmail(email: string): any;
  isMatchPassword(password: string, hashPassword: string): Promise<boolean>;
  isMatchHashedOtp(plainOtp: number | string, hashedOtp: string): Promise<boolean>;
} & Model<IUser>;
