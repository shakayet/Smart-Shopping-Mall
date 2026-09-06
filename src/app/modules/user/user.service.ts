import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import { USER_ROLES } from '../../../enums/user';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
} from '../../../enums/order';
import config from '../../../config';
import ApiError from '../../../errors/ApiError';
import { emailHelper } from '../../../helpers/emailHelper';
import { emailTemplate } from '../../../shared/emailTemplate';
import generateOTP from '../../../util/generateOTP';
import QueryBuilder from '../../builder/QueryBuilder';
import { IUser } from './user.interface';
import { User } from './user.model';
import { Order } from '../order/order.model';
import { Product } from '../product/product.model';
import { NotificationService } from '../notification/notification.service';
import { errorLogger } from '../../../shared/logger';
import {
  isOwnedProfileImage,
  removeStoredProfileImage,
} from '../../../helpers/profileImageStorage';
import { invalidateAllProductCaches } from '../product/product-state-sync';
import {
  getFixedTestOtp,
  isFixedTestOtpEmail,
} from '../../../helpers/fixedTestOtp';

const getAllUsersToDB = async (query: Record<string, unknown>) => {
  const userQuery = new QueryBuilder(User.find(), query)
    .search(['name', 'email', 'contact'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const [result, meta] = await Promise.all([
    userQuery.modelQuery,
    userQuery.getPaginationInfo(),
  ]);

  return { result, meta };
};

type CreateUserPayload = Partial<IUser> & {
  firstName?: string;
  lastName?: string;
};

const toUserProfile = (user: unknown) => {
  const value = (
    user &&
    typeof user === 'object' &&
    'toJSON' in user &&
    typeof user.toJSON === 'function'
      ? user.toJSON()
      : user
  ) as Record<string, unknown>;

  delete value.password;
  delete value.authentication;
  delete value.loginOtp;
  delete value.stripeAccountId;
  delete value.stripeCustomerId;
  delete value.__v;

  let location = typeof value.location === 'string' ? value.location : null;
  let country = typeof value.country === 'string' ? value.country : null;
  if (!country && location?.includes(',')) {
    const locationParts = location.split(',').map(part => part.trim());
    country = locationParts.pop() || null;
    location = locationParts.join(', ') || null;
  }

  return {
    ...value,
    phone:
      (typeof value.phone === 'string' && value.phone) ||
      (typeof value.contact === 'string' && value.contact) ||
      null,
    country,
    location,
  };
};

const createUserToDB = async (payload: CreateUserPayload): Promise<IUser> => {
  // App users are passwordless. Enforce this even for internal callers that
  // do not pass through the HTTP validation middleware.
  const { firstName, lastName, ...userData } = payload;
  delete userData.password;
  userData.role = USER_ROLES.USER;
  userData.name = [firstName, lastName]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const createUser = await User.create(userData);
  if (!createUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create user');
  }

  //send email
  const otp = getFixedTestOtp(createUser.email!) ?? generateOTP();
  const values = {
    name: createUser.name,
    otp: otp,
    email: createUser.email!,
  };
  if (!isFixedTestOtpEmail(createUser.email!)) {
    const createAccountTemplate = emailTemplate.createAccount(values);
    void emailHelper.sendEmail(createAccountTemplate);
  }

  //save to DB
  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };
  await User.findOneAndUpdate(
    { _id: createUser._id },
    { $set: { authentication } },
  );

  return createUser;
};

const getUserProfileFromDB = async (user: JwtPayload) => {
  const { id } = user;
  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  return toUserProfile(isExistUser);
};

const getProfileStatsFromDB = async (userId: string) => {
  const user = await User.findById(userId).select('status verified').lean();
  if (!user || user.status !== 'active' || !user.verified) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User profile not found');
  }

  const [totalProductsListed, totalProductsPurchased, earnings] =
    await Promise.all([
      Product.countDocuments({ seller: userId }),
      Order.countDocuments({
        buyer: userId,
        'payment.status': PAYMENT_STATUS.PAID,
        status: {
          $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED],
        },
      }),
      Order.aggregate<{ totalEarnings: number }>([
        {
          $match: {
            seller: user._id,
            payoutStatus: PAYOUT_STATUS.PAID,
          },
        },
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: '$sellerPayout' },
          },
        },
        { $project: { _id: 0, totalEarnings: 1 } },
      ]),
    ]);

  return {
    totalProductsListed,
    totalProductsPurchased,
    totalEarnings: Number((earnings[0]?.totalEarnings ?? 0).toFixed(2)),
    currency: config.stripe.currency.toUpperCase(),
  };
};

const updateProfileToDB = async (
  user: JwtPayload,
  payload: Partial<IUser>,
) => {
  const { id } = user;
  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    if (payload.image) {
      await removeStoredProfileImage(payload.image).catch(() => undefined);
    }
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  let updateDoc;
  try {
    updateDoc = await User.findOneAndUpdate({ _id: id }, payload, {
      new: true,
    });
  } catch (error) {
    if (payload.image) {
      await removeStoredProfileImage(payload.image).catch(() => undefined);
    }
    throw error;
  }

  if (!updateDoc && payload.image) {
    await removeStoredProfileImage(payload.image).catch(() => undefined);
  }
  if (updateDoc && payload.image) {
    const previousImages = new Set([isExistUser.image, isExistUser.avatar]);
    previousImages.delete(payload.image);
    for (const previousImage of previousImages) {
      try {
        await removeStoredProfileImage(previousImage);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errorLogger.error(
          `[PROFILE_IMAGE] Old image cleanup failed for user ${id}: ${message}`,
        );
      }
    }
  }

  if (updateDoc) invalidateAllProductCaches();

  return updateDoc ? toUserProfile(updateDoc) : null;
};

const deleteProfilePhotoFromDB = async (user: JwtPayload) => {
  const { id } = user;
  const existingUser = await User.findById(id);
  if (!existingUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const previousImage = existingUser.image;
  const previousAvatar = existingUser.avatar;
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: id,
      image: previousImage,
      avatar: previousAvatar,
    },
    { $set: { image: null, avatar: null } },
    { new: true },
  );
  if (!updatedUser) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Profile photo changed while it was being deleted',
    );
  }

  const storedImages = [...new Set([previousImage, previousAvatar])].filter(
    isOwnedProfileImage,
  );
  try {
    for (const storedImage of storedImages) {
      await removeStoredProfileImage(storedImage);
    }
  } catch (error) {
    await User.updateOne(
      { _id: id, image: null, avatar: null },
      { $set: { image: previousImage, avatar: previousAvatar } },
    );
    invalidateAllProductCaches();
    throw new ApiError(
      StatusCodes.BAD_GATEWAY,
      'Unable to delete the profile photo from storage',
    );
  }

  invalidateAllProductCaches();
  return toUserProfile(updatedUser);
};

const deleteAccountFromDB = async (user: JwtPayload) => {
  const { id } = user;
  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const storedImages = [...new Set([isExistUser.image, isExistUser.avatar])];
  for (const storedImage of storedImages) {
    await removeStoredProfileImage(storedImage);
  }

  const deleteDoc = await User.findByIdAndDelete(id);
  await NotificationService.deleteUserNotificationData(id);
  return deleteDoc;
};

export const UserService = {
  getAllUsersToDB,
  createUserToDB,
  getUserProfileFromDB,
  getProfileStatsFromDB,
  updateProfileToDB,
  deleteProfilePhotoFromDB,
  deleteAccountFromDB,
  toUserProfile,
};
