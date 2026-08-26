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
      reason: 'Authentication evidence indicates a counterfeit item',
    },
  });
  const invalid = IssueValidation.createIssueZodSchema.safeParse({
    body: {
      productId: 'product-1',
      issueType: 'verification_failed',
      outcome: ORDER_OUTCOME.BUYER_CHANGED_MIND,
      reason: 'Mismatched workflow',
    },
  });
  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});
