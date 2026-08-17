import Stripe from 'stripe';
import config from '../config';
import { toMinorUnits } from '../util/money';

export const stripeClient = new Stripe(config.stripe.secretKey as string);

export const createPaymentIntent = async (
  amount: number,
  metadata: Record<string, string>,
  idempotencyKey: string,
  customerId: string,
) => {
  return stripeClient.paymentIntents.create(
    {
      amount: toMinorUnits(amount),
      currency: config.stripe.currency,
      customer: customerId,
      metadata,
      transfer_group: metadata.orderNumber,
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey },
  );
};

export const createRefund = async (
  paymentIntentId: string,
  idempotencyKey: string,
) => {
  return stripeClient.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey },
  );
};

export const cancelPaymentIntent = async (paymentIntentId: string) =>
  stripeClient.paymentIntents.cancel(paymentIntentId);

export const createStripeCustomer = async (
  userId: string,
  email: string,
  name?: string,
) =>
  stripeClient.customers.create(
    {
      email,
      name: name || undefined,
      metadata: { appUserId: userId },
    },
    { idempotencyKey: `stripe-customer:${userId}` },
  );

export const listCustomerCardPaymentMethods = async (
  customerId: string,
  limit: number,
  startingAfter?: string,
) =>
  stripeClient.paymentMethods.list({
    customer: customerId,
    type: 'card',
    limit,
    starting_after: startingAfter,
  });

export const createCardSetupIntent = async (
  customerId: string,
  userId: string,
  idempotencyKey: string,
) =>
  stripeClient.setupIntents.create(
    {
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { appUserId: userId },
    },
    { idempotencyKey },
  );

export const retrieveCustomerPaymentMethod = async (
  customerId: string,
  paymentMethodId: string,
) => stripeClient.customers.retrievePaymentMethod(customerId, paymentMethodId);

export const detachPaymentMethod = async (paymentMethodId: string) =>
  stripeClient.paymentMethods.detach(paymentMethodId);

export const createConnectedAccount = async (email: string) =>
  stripeClient.accounts.create({
    type: 'express',
    country: config.stripe.connectCountry,
    email,
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
  });

export const createConnectedAccountLink = async (
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
) =>
  stripeClient.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });

export const retrieveConnectedAccount = async (accountId: string) =>
  stripeClient.accounts.retrieve(accountId);

export const createSellerTransfer = async (
  amount: number,
  destination: string,
  orderNumber: string,
) =>
  stripeClient.transfers.create(
    {
      amount: toMinorUnits(amount),
      currency: config.stripe.currency,
      destination,
      transfer_group: orderNumber,
      metadata: { orderNumber },
    },
    { idempotencyKey: `seller-payout:${orderNumber}` },
  );

export const reverseSellerTransfer = async (
  transferId: string,
  amount: number,
  orderNumber: string,
) =>
  stripeClient.transfers.createReversal(
    transferId,
    {
      amount: toMinorUnits(amount),
      metadata: { orderNumber },
    },
    { idempotencyKey: `seller-payout-reversal:${orderNumber}` },
  );
