import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import {
  createCardSetupIntent,
  createStripeCustomer,
  detachPaymentMethod as detachStripePaymentMethod,
  listCustomerCardPaymentMethods,
  retrieveCustomerPaymentMethod,
} from '../../../integrations/stripe';
import { errorLogger } from '../../../shared/logger';
import { User } from '../user/user.model';
import {
  createSetupIntentIdempotencyKey,
  isPaymentMethodOwnedByCustomer,
  isValidClientIdempotencyKey,
  toSavedCard,
} from './payment-method.util';

type IListPaymentMethodsQuery = {
  limit?: unknown;
  startingAfter?: unknown;
};

type IStripeErrorDetails = {
  code?: unknown;
  type?: unknown;
  statusCode?: unknown;
};

const throwPaymentProviderError = (
  operation: string,
  error: unknown,
  notFoundMessage?: string,
): never => {
  const details = error as IStripeErrorDetails;
  if (details?.code === 'resource_missing' && notFoundMessage) {
    throw new ApiError(StatusCodes.NOT_FOUND, notFoundMessage);
  }

  errorLogger.error(`[PAYMENT_METHOD] ${operation} failed`, {
    type: typeof details?.type === 'string' ? details.type : undefined,
    code: typeof details?.code === 'string' ? details.code : undefined,
    statusCode:
      typeof details?.statusCode === 'number' ? details.statusCode : undefined,
  });
  throw new ApiError(
    StatusCodes.BAD_GATEWAY,
    'Payment provider is temporarily unavailable',
  );
};

const getEligibleUser = async (userId: string) => {
  const user = await User.findById(userId).select('+stripeCustomerId');
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User account not found');
  }
  if (user.status !== 'active' || !user.verified) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account cannot manage payment methods',
    );
  }
  return user;
};

const getOrCreateCustomerId = async (userId: string) => {
  const user = await getEligibleUser(userId);
  if (user.stripeCustomerId) return user.stripeCustomerId;

  let customerId: string;
  try {
    const customer = await createStripeCustomer(userId, user.email, user.name);
    customerId = customer.id;
  } catch (error) {
    return throwPaymentProviderError('create customer', error);
  }

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { stripeCustomerId: { $exists: false } },
        { stripeCustomerId: null },
      ],
    },
    { $set: { stripeCustomerId: customerId } },
    { new: true },
  ).select('+stripeCustomerId');

  if (updatedUser?.stripeCustomerId) return updatedUser.stripeCustomerId;

  const currentUser = await getEligibleUser(userId);
  if (currentUser.stripeCustomerId) return currentUser.stripeCustomerId;

  throw new ApiError(
    StatusCodes.INTERNAL_SERVER_ERROR,
    'Unable to initialize payment profile',
  );
};

const getPaymentMethods = async (
  userId: string,
  query: IListPaymentMethodsQuery,
) => {
  const user = await getEligibleUser(userId);
  if (!user.stripeCustomerId) {
    return { paymentMethods: [], hasMore: false, nextCursor: null };
  }

  const limit = Number(query.limit) || 20;
  const startingAfter =
    typeof query.startingAfter === 'string' ? query.startingAfter : undefined;

  try {
    const paymentMethods = await listCustomerCardPaymentMethods(
      user.stripeCustomerId,
      limit,
      startingAfter,
    );
    const cards = paymentMethods.data
      .map(toSavedCard)
      .filter((card): card is NonNullable<typeof card> => card !== null);

    return {
      paymentMethods: cards,
      hasMore: paymentMethods.has_more,
      nextCursor:
        paymentMethods.has_more && cards.length > 0
          ? cards[cards.length - 1].id
          : null,
    };
  } catch (error) {
    return throwPaymentProviderError('list cards', error);
  }
};

const createSetupIntent = async (
  userId: string,
  clientIdempotencyKey?: string,
) => {
  if (
    clientIdempotencyKey !== undefined &&
    !isValidClientIdempotencyKey(clientIdempotencyKey)
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Idempotency-Key header');
  }

  const customerId = await getOrCreateCustomerId(userId);
  const idempotencyKey = createSetupIntentIdempotencyKey(
    userId,
    clientIdempotencyKey,
  );

  try {
    const setupIntent = await createCardSetupIntent(
      customerId,
      userId,
      idempotencyKey,
    );
    if (!setupIntent.client_secret) {
      throw new Error('Stripe SetupIntent did not include a client secret');
    }
    return { clientSecret: setupIntent.client_secret };
  } catch (error) {
    return throwPaymentProviderError('create setup intent', error);
  }
};

const deletePaymentMethod = async (
  userId: string,
  paymentMethodId: string,
) => {
  const user = await getEligibleUser(userId);
  if (!user.stripeCustomerId) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Payment method not found');
  }

  try {
    const paymentMethod = await retrieveCustomerPaymentMethod(
      user.stripeCustomerId,
      paymentMethodId,
    );
    if (
      paymentMethod.type !== 'card' ||
      !isPaymentMethodOwnedByCustomer(paymentMethod, user.stripeCustomerId)
    ) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Payment method not found');
    }
    await detachStripePaymentMethod(paymentMethodId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return throwPaymentProviderError(
      'delete card',
      error,
      'Payment method not found',
    );
  }
};

export const PaymentMethodService = {
  getPaymentMethods,
  createSetupIntent,
  deletePaymentMethod,
  getOrCreateCustomerId,
};
