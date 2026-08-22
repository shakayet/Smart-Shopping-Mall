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
import unlinkFile from '../../../shared/unlinkFile';
import generateOTP from '../../../util/generateOTP';
import QueryBuilder from '../../builder/QueryBuilder';
import { IUser } from './user.interface';
import { User } from './user.model';
import { Order } from '../order/order.model';
import { Product } from '../product/product.model';
import { NotificationService } from '../notification/notification.service';

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
  const otp = generateOTP();
  const values = {
    name: createUser.name,
    otp: otp,
    email: createUser.email!,
  };
  const createAccountTemplate = emailTemplate.createAccount(values);
  emailHelper.sendEmail(createAccountTemplate);

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
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //unlink file here
  if (payload.image) {
    unlinkFile(isExistUser.image);
  }

  const updateDoc = await User.findOneAndUpdate({ _id: id }, payload, {
    new: true,
  });

  return updateDoc ? toUserProfile(updateDoc) : null;
};

const deleteAccountFromDB = async (user: JwtPayload) => {
  const { id } = user;
  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //unlink file here
  if (isExistUser.image) {
    unlinkFile(isExistUser.image);
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
  deleteAccountFromDB,
  toUserProfile,
};
