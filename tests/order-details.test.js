const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildOrderDetails,
  getDeliveryState,
  getOrderProgress,
  getVerificationState,
} = require('../dist/app/modules/order/order.presenter');

test('order progress exposes stable UI states', () => {
  const progress = getOrderProgress('verification', [
    { status: 'pending_payment' },
    { status: 'secured' },
    { status: 'collected' },
  ]);

  assert.deepEqual(
    progress.map(step => [step.key, step.state]),
    [
      ['reserved', 'completed'],
      ['collected', 'completed'],
      ['verified', 'current'],
      ['delivered', 'pending'],
    ],
  );
  assert.deepEqual(getDeliveryState('ready_for_delivery'), {
    status: 'ready_for_delivery',
    label: 'Ready for delivery',
  });
});

test('verification state distinguishes pending, verified, and failed orders', () => {
  assert.equal(getVerificationState('verification', false).status, 'in_progress');
  assert.equal(getVerificationState('payout_processing', false).isVerified, true);
  assert.equal(getVerificationState('refunded', true).status, 'failed');
});

test('order details include the UI contract and redact Stripe identifiers', () => {
  const result = buildOrderDetails({
    order: {
      _id: 'order-1',
      orderNumber: 'CLT-123',
      status: 'ready_for_delivery',
      price: 3200,
      platformFee: 384,
      sellerPayout: 2816,
      product: {
        _id: 'product-1',
        orderId: 347892,
        name: 'Gucci Diana Tote',
        brand: 'Gucci',
        images: ['https://example.com/gucci.jpg'],
        material: 'Black Leather',
        features: ['Bamboo Handle'],
        condition: 'Excellent',
        description: 'Item is in excellent condition',
        originalPackagingAvailable: true,
      },
      seller: {
        _id: 'seller-1',
        name: 'Seller',
        contact: '+971500000001',
        location: 'Dubai',
      },
      buyer: { _id: 'buyer-1', name: 'Buyer' },
      deliveryDetails: {
        address: '10 Test Street',
        location: 'Abu Dhabi',
        phone: '+971500000002',
      },
      pickupWindow: {
        start: '2026-08-18T07:00:00.000Z',
        end: '2026-08-18T10:00:00.000Z',
      },
      estimatedDeliveryAt: '2026-08-19T10:00:00.000Z',
      note: 'Handle with care',
      statusHistory: [{ status: 'ready_for_delivery', changedAt: new Date() }],
      payment: {
        provider: 'stripe',
        status: 'paid',
        paymentIntentId: 'pi_must_not_leak',
      },
      payoutStatus: 'paid',
    },
    openIssue: null,
    viewer: { id: 'admin-1', role: 'ADMIN' },
    currency: 'AED',
  });

  assert.equal(result.product.brand, 'Gucci');
  assert.equal(result.product.details.displayText, 'Black Leather • Bamboo Handle');
  assert.equal(result.product.currency, 'AED');
  assert.equal(result.product.verified, true);
  assert.equal(result.seller.phone, '+971500000001');
  assert.equal(result.buyer.phone, '+971500000002');
  assert.equal(result.buyer.location, 'Abu Dhabi');
  assert.equal(result.actions.markAsDelivered.enabled, true);
  assert.equal(result.actions.reportIssue.enabled, true);
  assert.equal(result.payment.paymentIntentId, undefined);
});
