import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import config from '../../../config';
import ApiError from '../../../errors/ApiError';
import {
  createConnectedAccount,
  createConnectedAccountLink,
  retrieveConnectedAccount,
} from '../../../integrations/stripe';
import { User } from '../user/user.model';

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
  const user = await User.findById(userId).select('+stripeAccountId');
  if (!user?.stripeAccountId) {
    return {
      connected: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
      chargesEnabled: false,
    };
  }
  const account = await retrieveConnectedAccount(user.stripeAccountId);
  return {
    connected: true,
    detailsSubmitted: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
    chargesEnabled: account.charges_enabled,
    requirementsDue: account.requirements?.currently_due ?? [],
  };
};

const onboardingLink = async (userId: string) => {
  const user = await User.findById(userId).select('+stripeAccountId');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  if (!user.stripeAccountId) {
    const account = await createConnectedAccount(user.email);
    user.stripeAccountId = account.id;
    await user.save();
  }

  const state = createState(userId);
  const base = `${config.stripe.publicUrl}/api/v1/payment/connect`;
  const link = await createConnectedAccountLink(
    user.stripeAccountId,
    `${base}/return?state=${encodeURIComponent(state)}`,
    `${base}/refresh?state=${encodeURIComponent(state)}`,
  );
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
};
