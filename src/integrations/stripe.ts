import Stripe from 'stripe';
import config from '../config';

export const stripeClient = new Stripe(config.stripe.secretKey as string);

export const createPaymentIntent = async (
  amount: number,
  metadata: Record<string, string>,
) => {
  return stripeClient.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: config.stripe.currency,
    metadata,
    automatic_payment_methods: { enabled: true },
  });
};

export const createRefund = async (paymentIntentId: string) => {
  return stripeClient.refunds.create({
    payment_intent: paymentIntentId,
  });
};
