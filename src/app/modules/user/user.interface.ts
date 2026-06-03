/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-vars */
import { Model } from 'mongoose';
import { USER_ROLES } from '../../../enums/user';

export type IUser = {
  name: string;
  firstName?: string;
  lastName?: string;
  role: USER_ROLES;
  contact?: string;
  email: string;
  password: string;
  location?: string;
  image?: string;
  avatar?: string;
  status: 'active' | 'delete';
  verified: boolean;
  provider?: 'local' | 'google' | 'facebook' | 'github';
  providerId?: string;
  authentication?: {
    isResetPassword: boolean;
    oneTimeCode: number;
    expireAt: Date;
  };
};

export type UserModal = {
  isExistUserById(id: string): any;
  isExistUserByEmail(email: string): any;
  isMatchPassword(password: string, hashPassword: string): boolean;
} & Model<IUser>;
