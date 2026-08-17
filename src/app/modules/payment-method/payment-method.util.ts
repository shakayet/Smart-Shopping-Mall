import crypto from 'crypto';

type IPaymentMethod = {
  id: string;
  type: string;
  customer?: string | { id: string } | null;
  card?: {
    brand: string;
    display_brand?: string | null;
    last4: string;
    exp_month: number;
    exp_year: number;
    funding: string;
  } | null;
};

export type ISavedCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  funding: string;
};

export const toSavedCard = (
  paymentMethod: IPaymentMethod,
): ISavedCard | null => {
  if (paymentMethod.type !== 'card' || !paymentMethod.card) return null;

  return {
    id: paymentMethod.id,
    brand: paymentMethod.card.display_brand || paymentMethod.card.brand,
    last4: paymentMethod.card.last4,
    expMonth: paymentMethod.card.exp_month,
    expYear: paymentMethod.card.exp_year,
    funding: paymentMethod.card.funding,
  };
};

export const isValidPaymentMethodId = (value: string) =>
  /^pm_[A-Za-z0-9_]+$/.test(value) && value.length <= 255;

export const isValidClientIdempotencyKey = (value: string) =>
  value.length >= 1 &&
  value.length <= 128 &&
  /^[A-Za-z0-9._:-]+$/.test(value);

export const createSetupIntentIdempotencyKey = (
  userId: string,
  clientKey: string = crypto.randomUUID(),
) => {
  const digest = crypto
    .createHash('sha256')
    .update(`${userId}:${clientKey}`)
    .digest('hex');
  return `setup-intent:${digest}`;
};

export const isPaymentMethodOwnedByCustomer = (
  paymentMethod: Pick<IPaymentMethod, 'customer'>,
  customerId: string,
) => {
  const customer = paymentMethod.customer;
  const ownerId = typeof customer === 'string' ? customer : customer?.id;
  return ownerId === customerId;
};
