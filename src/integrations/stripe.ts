import Stripe from 'stripe';
import config from '../config';
import { toMinorUnits } from '../util/money';

export const stripeClient = new Stripe(config.stripe.secretKey as string);

export const createPaymentIntent = async (
  amount: number,
  metadata: Record<string, string>,
  idempotencyKey: string,
) => {
  return stripeClient.paymentIntents.create(
    {
      amount: toMinorUnits(amount),
      currency: config.stripe.currency,
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
