const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ORDER_OUTCOME,
  ORDER_STATUS,
} = require('../dist/enums/order.js');
const {
  ORDER_STATUS_TRANSITIONS,
} = require('../dist/app/modules/order/order.constant.js');
const {
  refundAmountForOutcome,
} = require('../dist/app/modules/order/order.service.js');
const {
  OrderValidation,
} = require('../dist/app/modules/order/order.validation.js');
const {
  IssueValidation,
} = require('../dist/app/modules/issue/issue.validation.js');

test('authentication failure refunds the full payment', () => {
  const order = { price: 3200, sellerPayout: 2816 };
  assert.equal(
    refundAmountForOutcome(order, ORDER_OUTCOME.AUTHENTICATION_FAILED),
    3200,
  );
  assert.equal(
    refundAmountForOutcome(order, ORDER_OUTCOME.COUNTERFEIT),
    3200,
  );
});

test('delivery rejection retains the configured order handling fee', () => {
  const order = { price: 3200, sellerPayout: 2816 };
  for (const outcome of [
    ORDER_OUTCOME.NOT_AS_DESCRIBED,
    ORDER_OUTCOME.CONDITION_DIFFERS,
    ORDER_OUTCOME.BUYER_CHANGED_MIND,
    ORDER_OUTCOME.OTHERS,
  ]) {
    assert.equal(refundAmountForOutcome(order, outcome), 2816);
  }
});

test('ready-for-delivery orders support a policy refund transition', () => {
  assert.equal(
    ORDER_STATUS_TRANSITIONS[ORDER_STATUS.READY_FOR_DELIVERY].includes(
      ORDER_STATUS.REFUNDED,
    ),
    true,
  );
});

test('a secured order can be marked collected without a scheduling step', () => {
  assert.equal(
    ORDER_STATUS_TRANSITIONS[ORDER_STATUS.SECURED].includes(
      ORDER_STATUS.COLLECTED,
    ),
    true,
  );
});

test('order status validation accepts a typed delivery outcome', () => {
  const parsed = OrderValidation.updateOrderStatusZodSchema.safeParse({
    body: {
      status: ORDER_STATUS.REFUNDED,
      outcome: ORDER_OUTCOME.NOT_AS_DESCRIBED,
      note: 'The received item differs from its listing',
    },
  });
  assert.equal(parsed.success, true);
});

test('issue validation keeps outcomes aligned with the issue workflow', () => {
  const valid = IssueValidation.createIssueZodSchema.safeParse({
    body: {
      productId: 'product-1',
      issueType: 'verification_failed',
      outcome: ORDER_OUTCOME.COUNTERFEIT,
    },
  });
  const invalid = IssueValidation.createIssueZodSchema.safeParse({
    body: {
      productId: 'product-1',
      issueType: 'verification_failed',
      outcome: ORDER_OUTCOME.BUYER_CHANGED_MIND,
    },
  });
  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});

test('issue validation supports every dashboard report option', () => {
  const options = [
    ['verification_failed', ORDER_OUTCOME.AUTHENTICATION_FAILED],
    ['seller_unavailable', ORDER_OUTCOME.SELLER_UNAVAILABLE],
    ['buyer_refused', ORDER_OUTCOME.BUYER_CHANGED_MIND],
    ['buyer_refused', ORDER_OUTCOME.NOT_AS_DESCRIBED],
    ['buyer_refused', ORDER_OUTCOME.CONDITION_DIFFERS],
    ['buyer_refused', ORDER_OUTCOME.OTHERS],
    ['others', ORDER_OUTCOME.OTHERS],
  ];

  for (const [issueType, outcome] of options) {
    const parsed = IssueValidation.createIssueZodSchema.safeParse({
      body: {
        productId: 'product-1',
        issueType,
        outcome,
        ...(issueType === 'others'
          ? { reason: 'Dashboard supplied reason' }
          : {}),
      },
    });
    assert.equal(parsed.success, true, `${issueType}/${outcome}`);
  }
});

test('reason is accepted only for the top-level others option', () => {
  const missingOtherReason =
    IssueValidation.createIssueZodSchema.safeParse({
      body: {
        productId: 'product-1',
        issueType: 'others',
        outcome: ORDER_OUTCOME.OTHERS,
      },
    });
  const unexpectedPredefinedReason =
    IssueValidation.createIssueZodSchema.safeParse({
      body: {
        productId: 'product-1',
        issueType: 'buyer_refused',
        outcome: ORDER_OUTCOME.NOT_AS_DESCRIBED,
        reason: 'This must be omitted for predefined options',
      },
    });

  assert.equal(missingOtherReason.success, false);
  assert.equal(unexpectedPredefinedReason.success, false);
});
