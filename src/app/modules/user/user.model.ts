import bcrypt from 'bcrypt';
import { StatusCodes } from 'http-status-codes';
import { model, Schema } from 'mongoose';
import config from '../../../config';
import { USER_ROLES } from '../../../enums/user';
import ApiError from '../../../errors/ApiError';
import { IUser, UserModal } from './user.interface';

const authenticationSchema = new Schema(
  {
    isResetPassword: {
      type: Boolean,
      default: false,
    },
    oneTimeCode: {
      type: Number,
      default: null,
    },
    expireAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const loginOtpSchema = new Schema(
  {
    hashedCode: {
      type: String,
      default: null,
    },
    expireAt: {
      type: Date,
      default: null,
    },
    generatedAt: {
      type: Date,
      default: null,
    },
    consumed: {
      type: Boolean,
      default: false,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    resentCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false },
);

const userSchema = new Schema<IUser, UserModal>(
  {
    name: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    contact: {
      type: String,
    },
    location: {
      type: String,
    },
    password: {
      type: String,
      select: 0,
      minlength: 6,
      default: null,
    },
    image: {
      type: String,
      default: 'https://i.ibb.co/z5YHLV9/profile.png',
    },
    avatar: {
      type: String,
      default: null,
    },
    provider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    providerId: {
      type: String,
    },
    status: {
      type: String,
      enum: ['active', 'ban'],
      default: 'active',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    authentication: {
      type: authenticationSchema,
      select: 0,
    },
    loginOtp: {
      type: loginOtpSchema,
      select: 0,
    },
  },
  { timestamps: true },
);

userSchema.statics.isExistUserById = async (id: string) => {
  const isExist = await User.findById(id);
  return isExist;
};

userSchema.statics.isExistUserByEmail = async (email: string) => {
  const isExist = await User.findOne({ email });
  return isExist;
};

userSchema.statics.isMatchPassword = async (
  password: string,
  hashPassword: string,
): Promise<boolean> => {
  return await bcrypt.compare(password, hashPassword);
};

userSchema.statics.isMatchHashedOtp = async (
  plainOtp: number | string,
  hashedOtp: string,
): Promise<boolean> => {
  return await bcrypt.compare(String(plainOtp), hashedOtp);
};

userSchema.pre('save', async function (next) {
  const isExist = await User.findOne({ email: this.email });
  if (isExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email already exist!');
  }

  if (this.password && this.isModified('password')) {
    this.password = await bcrypt.hash(
      this.password,
      Number(config.bcrypt_salt_rounds),
    );
  }
  next();
});

export const User = model<IUser, UserModal>('User', userSchema);
