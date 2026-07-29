import { Types } from 'mongoose';

export type IResetToken = {
  user: Types.ObjectId;
  tokenHash: string;
  expireAt: Date;
};
