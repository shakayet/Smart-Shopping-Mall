const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createSetupIntentIdempotencyKey,
  isPaymentMethodOwnedByCustomer,
  isValidClientIdempotencyKey,
  isValidPaymentMethodId,
  toSavedCard,
} = require('../dist/app/modules/payment-method/payment-method.util');
const {
  PaymentMethodValidation,
} = require('../dist/app/modules/payment-method/payment-method.validation');

test('saved card responses expose only the approved display fields', () => {
  const result = toSavedCard({
    id: 'pm_card_123',
    type: 'card',
    customer: 'cus_private_123',
    billing_details: { email: 'private@example.com', phone: '+971500000000' },
    card: {
      brand: 'visa',
      display_brand: 'Visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2030,
      funding: 'credit',
      fingerprint: 'private-fingerprint',
    },
  });

  assert.deepEqual(result, {
    id: 'pm_card_123',
    brand: 'Visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
    funding: 'credit',
  });
  assert.equal(Object.hasOwn(result, 'customer'), false);
  assert.equal(Object.hasOwn(result, 'billing_details'), false);
  assert.equal(Object.hasOwn(result, 'fingerprint'), false);
});

test('payment method ownership accepts only the authenticated customer', () => {
  assert.equal(
    isPaymentMethodOwnedByCustomer({ customer: 'cus_owner' }, 'cus_owner'),
    true,
  );
  assert.equal(
    isPaymentMethodOwnedByCustomer(
      { customer: { id: 'cus_owner' } },
      'cus_owner',
    ),
    true,
  );
  assert.equal(
    isPaymentMethodOwnedByCustomer({ customer: 'cus_other' }, 'cus_owner'),
    false,
  );
  assert.equal(
    isPaymentMethodOwnedByCustomer({ customer: null }, 'cus_owner'),
    false,
  );
});

test('Stripe payment method IDs and client idempotency keys are bounded', () => {
  assert.equal(isValidPaymentMethodId('pm_card_visa'), true);
  assert.equal(isValidPaymentMethodId('../pm_card_visa'), false);
  assert.equal(isValidPaymentMethodId('pi_not_a_payment_method'), false);
  assert.equal(isValidClientIdempotencyKey('mobile-request:123'), true);
  assert.equal(isValidClientIdempotencyKey('contains spaces'), false);
  assert.equal(isValidClientIdempotencyKey('x'.repeat(129)), false);
});

test('SetupIntent idempotency keys are deterministic and user-scoped', () => {
  const first = createSetupIntentIdempotencyKey('user-1', 'request-1');
  const retry = createSetupIntentIdempotencyKey('user-1', 'request-1');
  const anotherUser = createSetupIntentIdempotencyKey('user-2', 'request-1');

  assert.equal(first, retry);
  assert.notEqual(first, anotherUser);
  assert.equal(first.includes('user-1'), false);
  assert.equal(first.includes('request-1'), false);
});

test('SetupIntent validation rejects raw card data', () => {
  assert.equal(
    PaymentMethodValidation.createSetupIntentZodSchema.safeParse({ body: {} })
      .success,
    true,
  );
  assert.equal(
    PaymentMethodValidation.createSetupIntentZodSchema.safeParse({
      body: { cardNumber: '4242424242424242', cvc: '123' },
    }).success,
    false,
  );
});

test('card list validation bounds pagination and validates cursors', () => {
  assert.equal(
    PaymentMethodValidation.listPaymentMethodsZodSchema.safeParse({
      query: { limit: '100', startingAfter: 'pm_card_123' },
    }).success,
    true,
  );
  assert.equal(
    PaymentMethodValidation.listPaymentMethodsZodSchema.safeParse({
      query: { limit: '101' },
    }).success,
    false,
  );
  assert.equal(
    PaymentMethodValidation.listPaymentMethodsZodSchema.safeParse({
      query: { startingAfter: '../foreign-id' },
    }).success,
    false,
  );
});
