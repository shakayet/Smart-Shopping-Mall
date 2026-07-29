import { model, Schema } from 'mongoose';
import { IResetToken } from './resetToken.interface';

const resetTokenSchema = new Schema<IResetToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expireAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const ResetToken = model<IResetToken>('Token', resetTokenSchema);
