import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import config from '../../../config';
import ApiError from '../../../errors/ApiError';
import {
  createConnectedAccount,
  createConnectedAccountLink,
  retrieveConnectedAccount,
} from '../../../integrations/stripe';
import { errorLogger } from '../../../shared/logger';
import { User } from '../user/user.model';
import { NotificationEvent } from '../notification/notification.event';

type IStripeErrorDetails = {
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
  statusCode?: unknown;
  type?: unknown;
};

const throwConnectProviderError = (
  operation: string,
  error: unknown,
): never => {
  const details = error as IStripeErrorDetails;

  const diagnostic = [
    `operation=${operation}`,
    typeof details?.type === 'string' ? `type=${details.type}` : '',
    typeof details?.code === 'string' ? `code=${details.code}` : '',
    typeof details?.statusCode === 'number'
      ? `status=${details.statusCode}`
      : '',
    typeof details?.requestId === 'string'
      ? `requestId=${details.requestId}`
      : '',
    typeof details?.message === 'string' ? `message=${details.message}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  errorLogger.error(`[STRIPE_CONNECT] ${diagnostic}`);
  throw new ApiError(
    StatusCodes.SERVICE_UNAVAILABLE,
    'Seller payout onboarding is currently unavailable',
  );
};

const stateSignature = (payload: string) =>
  crypto
    .createHmac('sha256', config.oauth.sessionSecret)
    .update(payload)
    .digest('base64url');

const createState = (userId: string) => {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: Date.now() + 30 * 60 * 1000 }),
  ).toString('base64url');
  return `${payload}.${stateSignature(payload)}`;
};

const readState = (state: string) => {
  const [payload, signature] = state.split('.');
  const expectedSignature = payload ? stateSignature(payload) : '';
  if (
    !payload ||
    !signature ||
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    )
  ) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid onboarding state');
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
    userId: string;
    expiresAt: number;
  };
  if (data.expiresAt < Date.now()) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Onboarding state expired');
  }
  return data;
};

const accountStatus = async (userId: string) => {
  const user = await User.findOne({
    _id: userId,
    status: 'active',
    verified: true,
  }).select('+stripeAccountId');
  if (!user) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Account is not eligible for seller payouts',
    );
  }
  if (!user.stripeAccountId) {
    return {
      connected: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
      chargesEnabled: false,
    };
  }
  let account: Awaited<ReturnType<typeof retrieveConnectedAccount>>;
  try {
    account = await retrieveConnectedAccount(user.stripeAccountId);
  } catch (error) {
    return throwConnectProviderError('retrieve account', error);
  }
  return {
    connected: true,
    detailsSubmitted: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
    chargesEnabled: account.charges_enabled,
    requirementsDue: account.requirements?.currently_due ?? [],
  };
};

const assertPayoutReady = async (userId: string) => {
  const status = await accountStatus(userId);
  if (!status.connected || !status.detailsSubmitted || !status.payoutsEnabled) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Complete Stripe payout onboarding before creating a product listing',
    );
  }
};

const onboardingLink = async (userId: string) => {
  const user = await User.findOne({
    _id: userId,
    status: 'active',
    verified: true,
  }).select('+stripeAccountId');
  if (!user) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Account is not eligible for seller payouts',
    );
  }

  let accountId = user.stripeAccountId;

  if (!accountId) {
    let account: Awaited<ReturnType<typeof createConnectedAccount>>;
    try {
      account = await createConnectedAccount(userId, user.email);
    } catch (error) {
      return throwConnectProviderError('create account', error);
    }
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: userId,
        status: 'active',
        verified: true,
        $or: [
          { stripeAccountId: { $exists: false } },
          { stripeAccountId: null },
        ],
      },
      { $set: { stripeAccountId: account.id } },
      { new: true },
    ).select('+stripeAccountId');

    accountId = updatedUser?.stripeAccountId;
    if (!accountId) {
      const currentUser = await User.findOne({
        _id: userId,
        status: 'active',
        verified: true,
      }).select('+stripeAccountId');
      accountId = currentUser?.stripeAccountId;
    }

    if (!accountId) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Unable to initialize seller payout account',
      );
    }
  }

  const state = createState(userId);
  const base = `${config.stripe.publicUrl}/api/v1/payment/connect`;
  let link: Awaited<ReturnType<typeof createConnectedAccountLink>>;
  try {
    link = await createConnectedAccountLink(
      accountId,
      `${base}/return?state=${encodeURIComponent(state)}`,
      `${base}/refresh?state=${encodeURIComponent(state)}`,
    );
  } catch (error) {
    return throwConnectProviderError('create account link', error);
  }
  void NotificationEvent.sellerOnboardingRequired(userId);
  return { url: link.url, expiresAt: link.expires_at };
};

const statusFromState = async (state: string) => {
  const { userId } = readState(state);
  return accountStatus(userId);
};

const refreshFromState = async (state: string) => {
  const { userId } = readState(state);
  return onboardingLink(userId);
};

export const ConnectService = {
  onboardingLink,
  accountStatus,
  statusFromState,
  refreshFromState,
  assertPayoutReady,
};
