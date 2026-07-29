import { Schema, model } from 'mongoose';

type OAuthCodeDocument = {
  codeHash: string;
  user: Schema.Types.ObjectId;
  expiresAt: Date;
};

const oauthCodeSchema = new Schema<OAuthCodeDocument>(
  {
    codeHash: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const OAuthCode = model<OAuthCodeDocument>('OAuthCode', oauthCodeSchema);
