/* eslint-disable @typescript-eslint/no-explicit-any */
import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import config from '../../../config';
import {
  ORDER_OUTCOME,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
} from '../../../enums/order';
import { USER_ROLES } from '../../../enums/user';
import { ISSUE_TYPE } from '../../../enums/issue';
import ApiError from '../../../errors/ApiError';
import {
  cancelPaymentIntent,
  createPaymentIntent,
  createRefund,
  reverseSellerTransfer,
} from '../../../integrations/stripe';
import {
  createSellerTransfer,
  retrieveConnectedAccount,
} from '../../../integrations/stripe';
import QueryBuilder from '../../builder/QueryBuilder';
import { Product } from '../product/product.model';
import {
  ORDER_STATUS_TRANSITIONS,
  REFUND_TRIGGER_STATUSES,
} from './order.constant';
import { IDeliveryDetails } from './order.interface';
import { Order } from './order.model';
import { User } from '../user/user.model';
import { PaymentMethodService } from '../payment-method/payment-method.service';
import { Issue } from '../issue/issue.model';
import { buildOrderDetails } from './order.presenter';
import { NotificationEvent } from '../notification/notification.event';
import { synchronizeProductStatusMutation } from '../product/product-state-sync';
import { UserPenaltyService } from '../user/user-penalty.service';

const AUTHENTICATION_FAILURE_OUTCOMES = new Set<ORDER_OUTCOME>([
  ORDER_OUTCOME.AUTHENTICATION_FAILED,
  ORDER_OUTCOME.COUNTERFEIT,
]);
const DELIVERY_REJECTION_OUTCOMES = new Set<ORDER_OUTCOME>([
  ORDER_OUTCOME.NOT_AS_DESCRIBED,
  ORDER_OUTCOME.CONDITION_DIFFERS,
  ORDER_OUTCOME.BUYER_CHANGED_MIND,
]);

export const refundAmountForOutcome = (
  order: { price: number; sellerPayout: number },
  outcome: ORDER_OUTCOME,
) =>
  DELIVERY_REJECTION_OUTCOMES.has(outcome)
    ? order.sellerPayout
    : order.price;

const generateOrderNumber = () => {
  const random = Math.floor(100 + Math.random() * 900);
  return `CLT-${Date.now().toString().slice(-8)}${random}`;
};

const checkoutOrder = async (
  productId: string,
  buyerId: string,
  deliveryDetails: IDeliveryDetails,
  note?: string,
) => {
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  if (product.status !== 'available') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This item is no longer available',
    );
  }

  if (product.seller.toString() === buyerId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You cannot buy your own listing',
    );
  }

  const platformFee = Number(
    ((product.price * config.platform.feePercentage) / 100).toFixed(2),
  );
  const sellerPayout = Number((product.price - platformFee).toFixed(2));
  const orderNumber = generateOrderNumber();

  const reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const reservedProduct = await synchronizeProductStatusMutation(
    Product.findOneAndUpdate(
      {
        _id: product._id,
        status: 'available',
      },
      {
        $set: {
          status: 'secured',
          buyer: buyerId,
          reservationExpiresAt,
        },
      },
      { new: true },
    ),
    { productId: product._id.toString(), status: 'secured' },
  );
  if (!reservedProduct) {
    throw new ApiError(StatusCodes.CONFLICT, 'This item is being purchased');
  }

  let paymentIntent: Awaited<ReturnType<typeof createPaymentIntent>> | undefined;
  try {
    const customerId = await PaymentMethodService.getOrCreateCustomerId(buyerId);
    paymentIntent = await createPaymentIntent(
      product.price,
      {
        orderNumber,
        productId: String(product._id),
        buyerId,
      },
      `checkout:${orderNumber}`,
      customerId,
    );

    const order = await Order.create({
    orderNumber,
    product: product._id,
    buyer: buyerId,
    seller: product.seller,
    price: product.price,
    platformFee,
    sellerPayout,
    note: note?.trim(),
    deliveryDetails,
    payment: {
      provider: 'stripe',
      paymentIntentId: paymentIntent.id,
      status: PAYMENT_STATUS.PENDING,
    },
    payoutStatus: PAYOUT_STATUS.PENDING,
    status: ORDER_STATUS.PENDING_PAYMENT,
    statusHistory: [
      { status: ORDER_STATUS.PENDING_PAYMENT, changedAt: new Date() },
    ],
    });

    return { order, clientSecret: paymentIntent.client_secret };
  } catch (error) {
    if (paymentIntent) {
      await cancelPaymentIntent(paymentIntent.id).catch(() => undefined);
    }
    await synchronizeProductStatusMutation(
      Product.findOneAndUpdate(
        { _id: product._id, buyer: buyerId, reservationExpiresAt },
        {
          $set: { status: 'available' },
          $unset: { buyer: 1, reservationExpiresAt: 1 },
        },
      ),
      { productId: product._id.toString(), status: 'available' },
    );
    throw error;
  }
};

type SuccessfulPayment = {
  id: string;
  amountReceived: number;
  currency: string;
  metadata: Record<string, string>;
};

export const paymentMatchesOrder = (
  payment: SuccessfulPayment,
  order: {
    price: number;
    orderNumber: string;
    productId: string;
    buyerId: string;
  },
  currency: string,
) =>
  payment.amountReceived === Math.round(order.price * 100) &&
  payment.currency.toLowerCase() === currency.toLowerCase() &&
  payment.metadata.orderNumber === order.orderNumber &&
  payment.metadata.productId === order.productId &&
  payment.metadata.buyerId === order.buyerId;

const handlePaymentSucceeded = async (payment: SuccessfulPayment) => {
  const paymentIntentId = payment.id;
  const expectedOrder = await Order.findOne({
    'payment.paymentIntentId': paymentIntentId,
  });
  if (!expectedOrder) return;

  const validPayment = paymentMatchesOrder(
    payment,
    {
      price: expectedOrder.price,
      orderNumber: expectedOrder.orderNumber,
      productId: expectedOrder.product.toString(),
      buyerId: expectedOrder.buyer.toString(),
    },
    config.stripe.currency,
  );
  if (!validPayment) {
    await createRefund(
      paymentIntentId,
      `invalid-payment-refund:${expectedOrder._id.toString()}`,
    );
    await Order.findByIdAndUpdate(expectedOrder._id, {
      $set: {
        'payment.status': PAYMENT_STATUS.REFUNDED,
        status: ORDER_STATUS.REFUNDED,
      },
    });
    await synchronizeProductStatusMutation(
      Product.findOneAndUpdate(
        { _id: expectedOrder.product, buyer: expectedOrder.buyer },
        {
          $set: { status: 'available' },
          $unset: { buyer: 1, reservationExpiresAt: 1 },
        },
      ),
      { productId: expectedOrder.product.toString(), status: 'available' },
    );
    void NotificationEvent.orderStatusChanged(
      expectedOrder,
      ORDER_STATUS.REFUNDED,
    );
    void NotificationEvent.wishlistAvailabilityChanged(
      expectedOrder.product.toString(),
      true,
      `${expectedOrder._id.toString()}:invalid-payment`,
    );
    return;
  }

  const order = await Order.findOneAndUpdate(
    {
      'payment.paymentIntentId': paymentIntentId,
      'payment.status': PAYMENT_STATUS.PENDING,
      status: ORDER_STATUS.PENDING_PAYMENT,
    },
    {
      $set: {
        'payment.status': PAYMENT_STATUS.PAID,
        status: ORDER_STATUS.SECURED,
      },
      $push: {
        statusHistory: {
          status: ORDER_STATUS.SECURED,
          changedAt: new Date(),
        },
      },
    },
    { new: true },
  );
  if (!order) {
    const staleOrder = await Order.findOne({
      'payment.paymentIntentId': paymentIntentId,
      status: { $in: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED] },
    });
    if (staleOrder) {
      await createRefund(
        paymentIntentId,
        `late-payment-refund:${staleOrder._id.toString()}`,
      );
      const refundedOrder = await Order.findOneAndUpdate(
        {
          _id: staleOrder._id,
          status: { $in: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED] },
        },
        {
          $set: {
            'payment.status': PAYMENT_STATUS.REFUNDED,
            status: ORDER_STATUS.REFUNDED,
          },
          $push: {
            statusHistory: {
              status: ORDER_STATUS.REFUNDED,
              note: 'Late payment was automatically refunded',
              changedAt: new Date(),
            },
          },
        },
        { new: true },
      );
      if (refundedOrder) {
        void NotificationEvent.orderStatusChanged(
          refundedOrder,
          ORDER_STATUS.REFUNDED,
        );
      }
    }
    return;
  }

  await synchronizeProductStatusMutation(
    Product.findByIdAndUpdate(order.product, {
      $set: { status: 'secured', buyer: order.buyer },
      $unset: { reservationExpiresAt: 1 },
    }),
    { productId: order.product.toString(), status: 'secured' },
  );
  void NotificationEvent.paymentSucceeded(order);
  void NotificationEvent.wishlistAvailabilityChanged(
    order.product.toString(),
    false,
    order._id.toString(),
    [order.buyer.toString(), order.seller.toString()],
  );
};

const handlePaymentFailed = async (paymentIntentId: string) => {
  const order = await Order.findOne({
    'payment.paymentIntentId': paymentIntentId,
  });
  if (!order || order.payment.status === PAYMENT_STATUS.PAID) {
    return;
  }

  order.payment.status = PAYMENT_STATUS.FAILED;
  await order.save();
  await synchronizeProductStatusMutation(
    Product.findOneAndUpdate(
      { _id: order.product, buyer: order.buyer, status: 'secured' },
      {
        $set: { status: 'available' },
        $unset: { buyer: 1, reservationExpiresAt: 1 },
      },
    ),
    { productId: order.product.toString(), status: 'available' },
  );
  void NotificationEvent.paymentFailed(order);
};

const getMyOrders = async (
  userId: string,
  role: 'buyer' | 'seller',
  query: Record<string, unknown>,
) => {
  const filter = role === 'seller' ? { seller: userId } : { buyer: userId };

  const orderQuery = new QueryBuilder(Order.find(filter), query)
    .sort()
    .paginate();

  const [result, meta] = await Promise.all([
    orderQuery.modelQuery
      .populate('product')
      .populate('buyer', 'name email contact')
      .populate('seller', 'name email contact'),
    orderQuery.getPaginationInfo(),
  ]);

  return { result, meta };
};

const getOrderById = async (orderId: string, user: JwtPayload) => {
  const order = await Order.findById(orderId)
    .populate('product')
    .populate('buyer', 'name email phone contact location country image avatar')
    .populate('seller', 'name email phone contact location country image avatar');

  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  const isAdmin =
    user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPER_ADMIN;
  const buyerId = order.buyer?._id?.toString() ?? order.buyer?.toString();
  const sellerId = order.seller?._id?.toString() ?? order.seller?.toString();
  const isParty =
    buyerId === user.id || sellerId === user.id;

  if (!isAdmin && !isParty) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You don't have permission to view this order",
    );
  }

  const productId =
    order.product?._id?.toString() ?? order.product?.toString() ?? null;
  const latestIssue = productId
    ? await Issue.findOne({ product: productId })
        .sort({ createdAt: -1 })
        .lean()
    : null;

  return buildOrderDetails({
    order,
    openIssue: latestIssue,
    viewer: { id: user.id, role: user.role },
    currency: config.stripe.currency.toUpperCase(),
  });
};

type IOrderSchedulePayload = {
  pickupWindow?: { start: string; end: string };
  estimatedDeliveryAt?: string;
  note?: string;
};

const updateOrderSchedule = async (
  orderId: string,
  payload: IOrderSchedulePayload,
  user: JwtPayload,
) => {
  if (
    user.role !== USER_ROLES.ADMIN &&
    user.role !== USER_ROLES.SUPER_ADMIN
  ) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Admin access is required');
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }
  if (
    order.status === ORDER_STATUS.CANCELLED ||
    order.status === ORDER_STATUS.REFUNDED ||
    order.status === ORDER_STATUS.COMPLETED
  ) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'A terminal order schedule cannot be changed',
    );
  }

  const pickupWindow = payload.pickupWindow
    ? {
        start: new Date(payload.pickupWindow.start),
        end: new Date(payload.pickupWindow.end),
      }
    : undefined;
  const estimatedDeliveryAt = payload.estimatedDeliveryAt
    ? new Date(payload.estimatedDeliveryAt)
    : undefined;

  if (
    pickupWindow &&
    (!Number.isFinite(pickupWindow.start.getTime()) ||
      !Number.isFinite(pickupWindow.end.getTime()) ||
      pickupWindow.end <= pickupWindow.start)
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid pickup window');
  }
  if (
    estimatedDeliveryAt &&
    !Number.isFinite(estimatedDeliveryAt.getTime())
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Invalid estimated delivery date',
    );
  }

  const pickupEnd = pickupWindow?.end ?? order.pickupWindow?.end;
  const deliveryAt = estimatedDeliveryAt ?? order.estimatedDeliveryAt;
  if (
    deliveryAt &&
    pickupEnd &&
    deliveryAt < pickupEnd
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Estimated delivery must be after the pickup window',
    );
  }

  const updatedOrder = await Order.findByIdAndUpdate(
    orderId,
    {
      $set: {
        ...(pickupWindow ? { pickupWindow } : {}),
        ...(estimatedDeliveryAt ? { estimatedDeliveryAt } : {}),
        ...(payload.note !== undefined ? { note: payload.note.trim() } : {}),
      },
    },
    { new: true },
  );
  if (updatedOrder) {
    void NotificationEvent.orderScheduleUpdated(
      updatedOrder,
      (updatedOrder.get('updatedAt') as Date).getTime().toString(),
    );
  }

  return getOrderById(orderId, user);
};

const getAllOrdersForAdmin = async (query: Record<string, unknown>) => {
  const orderQuery = new QueryBuilder(Order.find(), query)
    .filter()
    .sort()
    .paginate();

  const [result, meta] = await Promise.all([
    orderQuery.modelQuery
      .populate('product')
      .populate('buyer', 'name email contact location')
      .populate('seller', 'name email contact location'),
    orderQuery.getPaginationInfo(),
  ]);

  return { result, meta };
};

const resolvePolicyOutcome = (
  currentStatus: ORDER_STATUS,
  targetStatus: ORDER_STATUS,
  requestedOutcome?: ORDER_OUTCOME,
) => {
  if (targetStatus !== ORDER_STATUS.REFUNDED) {
    if (requestedOutcome) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'An outcome can only be supplied for a policy refund',
      );
    }
    return undefined;
  }

  if (currentStatus === ORDER_STATUS.VERIFICATION) {
    const outcome =
      requestedOutcome ?? ORDER_OUTCOME.AUTHENTICATION_FAILED;
    if (!AUTHENTICATION_FAILURE_OUTCOMES.has(outcome)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Verification refunds require authentication_failed or counterfeit',
      );
    }
    return outcome;
  }

  if (currentStatus === ORDER_STATUS.READY_FOR_DELIVERY) {
    if (!requestedOutcome || !DELIVERY_REJECTION_OUTCOMES.has(requestedOutcome)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Delivery refunds require a valid buyer rejection outcome',
      );
    }
    return requestedOutcome;
  }

  if (requestedOutcome) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'The supplied outcome is not valid for this order state',
    );
  }
  return undefined;
};

const refundOrderPayment = async (
  order: InstanceType<typeof Order>,
  refundAmount: number,
) => {
  if (order.payoutTransferId && order.payoutStatus === PAYOUT_STATUS.PAID) {
    const reversal = await reverseSellerTransfer(
      order.payoutTransferId,
      order.sellerPayout,
      order.orderNumber,
    );
    order.payoutReversalId = reversal.id;
    order.payoutStatus = PAYOUT_STATUS.REVERSED;
  }

  if (order.payment.status === PAYMENT_STATUS.PAID) {
    await createRefund(
      order.payment.paymentIntentId,
      `order-refund:${order._id.toString()}`,
      refundAmount,
    );
    order.payment.status = PAYMENT_STATUS.REFUNDED;
  }

  order.refundAmount = refundAmount;
  order.handlingFeeCharged = Number(
    Math.max(0, order.price - refundAmount).toFixed(2),
  );
};

const applyOutcomePenalty = async (
  order: InstanceType<typeof Order>,
  outcome: ORDER_OUTCOME,
) => {
  if (
    AUTHENTICATION_FAILURE_OUTCOMES.has(outcome) ||
    outcome === ORDER_OUTCOME.NOT_AS_DESCRIBED ||
    outcome === ORDER_OUTCOME.CONDITION_DIFFERS
  ) {
    await UserPenaltyService.recordSellerOffence(
      order.seller.toString(),
      outcome,
    );
  } else if (outcome === ORDER_OUTCOME.BUYER_CHANGED_MIND) {
    await UserPenaltyService.recordUnjustifiedBuyerRejection(
      order.buyer.toString(),
    );
  }
};

const updateOrderStatus = async (
  orderId: string,
  targetStatus: ORDER_STATUS,
  note: string | undefined,
  adminId: string,
  requestedOutcome?: ORDER_OUTCOME,
  createPolicyIssue = true,
) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  const allowedTransitions = ORDER_STATUS_TRANSITIONS[order.status];
  if (!allowedTransitions.includes(targetStatus)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot move order from "${order.status}" to "${targetStatus}"`,
    );
  }

  const outcome = resolvePolicyOutcome(
    order.status,
    targetStatus,
    requestedOutcome,
  );

  if (
    targetStatus === ORDER_STATUS.READY_FOR_DELIVERY &&
    order.payoutStatus !== PAYOUT_STATUS.PAID
  ) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Release the seller payout before preparing the order for delivery',
    );
  }

  if (outcome) {
    await refundOrderPayment(
      order,
      refundAmountForOutcome(order, outcome),
    );
    order.outcome = outcome;
    if (
      outcome === ORDER_OUTCOME.AUTHENTICATION_FAILED ||
      outcome === ORDER_OUTCOME.COUNTERFEIT ||
      outcome === ORDER_OUTCOME.NOT_AS_DESCRIBED ||
      outcome === ORDER_OUTCOME.CONDITION_DIFFERS
    ) {
      order.returnShippingPayer = 'seller';
    }
    await synchronizeProductStatusMutation(
      Product.findByIdAndUpdate(order.product, {
        $set: { status: 'under_review' },
        $unset: { reservationExpiresAt: 1 },
      }),
      { productId: order.product.toString(), status: 'under_review' },
    );
  } else if (REFUND_TRIGGER_STATUSES.includes(targetStatus)) {
    if (order.payment.status === PAYMENT_STATUS.PAID) {
      await createRefund(
        order.payment.paymentIntentId,
        `order-refund:${order._id.toString()}`,
      );
      order.payment.status = PAYMENT_STATUS.REFUNDED;
    }
    await synchronizeProductStatusMutation(
      Product.findByIdAndUpdate(order.product, {
        $set: { status: 'available' },
        $unset: { buyer: 1, reservationExpiresAt: 1 },
      }),
      { productId: order.product.toString(), status: 'available' },
    );
  }

  if (
    targetStatus === ORDER_STATUS.COMPLETED ||
    targetStatus === ORDER_STATUS.DELIVERED
  ) {
    await synchronizeProductStatusMutation(
      Product.findByIdAndUpdate(order.product, { $set: { status: 'sold' } }),
      { productId: order.product.toString(), status: 'sold' },
    );
  }

  order.status = targetStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order.statusHistory.push({
    status: targetStatus,
    note,
    changedAt: new Date(),
    changedBy: adminId,
  } as any);

  await order.save();
  if (outcome) {
    if (createPolicyIssue) {
      await Issue.findOneAndUpdate(
        { product: order.product, resolved: false },
        {
          $setOnInsert: {
            product: order.product,
            buyer: order.buyer,
            seller: order.seller,
            issueType: AUTHENTICATION_FAILURE_OUTCOMES.has(outcome)
              ? ISSUE_TYPE.VERIFICATION_FAILED
              : ISSUE_TYPE.BUYER_REFUSED,
            outcome,
            reason: note?.trim() || outcome.replace(/_/g, ' '),
            admin: adminId,
            resolved: false,
          },
        },
        { upsert: true },
      );
    }
    await applyOutcomePenalty(order, outcome);
    if (AUTHENTICATION_FAILURE_OUTCOMES.has(outcome)) {
      void NotificationEvent.authenticationFailed(
        order,
        outcome as
          | ORDER_OUTCOME.AUTHENTICATION_FAILED
          | ORDER_OUTCOME.COUNTERFEIT,
      );
    } else {
      void NotificationEvent.deliveryRejected(
        order,
        outcome as
          | ORDER_OUTCOME.NOT_AS_DESCRIBED
          | ORDER_OUTCOME.CONDITION_DIFFERS
          | ORDER_OUTCOME.BUYER_CHANGED_MIND,
      );
    }
  } else {
    void NotificationEvent.orderStatusChanged(order, targetStatus);
  }
  if (
    !outcome &&
    (targetStatus === ORDER_STATUS.CANCELLED ||
      targetStatus === ORDER_STATUS.REFUNDED)
  ) {
    void NotificationEvent.wishlistAvailabilityChanged(
      order.product.toString(),
      true,
      `${order._id.toString()}:${targetStatus}`,
    );
  }
  return order;
};

const paySeller = async (order: InstanceType<typeof Order>) => {
  if (order.payoutStatus === PAYOUT_STATUS.PAID) return order;
  if (order.status !== ORDER_STATUS.PAYOUT_PROCESSING) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Seller payout is only available after authentication passes',
    );
  }
  if (order.payment.status !== PAYMENT_STATUS.PAID) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'The buyer payment is not settled');
  }

  const seller = await User.findById(order.seller).select('+stripeAccountId');
  if (!seller?.stripeAccountId) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Seller has not connected a Stripe payout account',
    );
  }
  const account = await retrieveConnectedAccount(seller.stripeAccountId);
  if (!account.details_submitted || !account.payouts_enabled) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Seller Stripe onboarding is incomplete or payouts are disabled',
    );
  }

  order.payoutStatus = PAYOUT_STATUS.PROCESSING;
  order.payoutFailureReason = undefined;
  await order.save();
  try {
    const transfer = await createSellerTransfer(
      order.sellerPayout,
      seller.stripeAccountId,
      order.orderNumber,
    );
    order.payoutTransferId = transfer.id;
    order.payoutStatus = PAYOUT_STATUS.PAID;
    await order.save();
    void NotificationEvent.payoutPaid(order);
    return order;
  } catch (error) {
    order.payoutStatus = PAYOUT_STATUS.FAILED;
    order.payoutFailureReason =
      error instanceof Error ? error.message : 'Stripe transfer failed';
    await order.save();
    throw error;
  }
};

const markPayoutPaid = async (orderId: string) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  return paySeller(order);
};

const reportMissedCollection = async (
  orderId: string,
  adminId: string,
  note?: string,
) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }
  if (order.status !== ORDER_STATUS.COLLECTION_PENDING) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'A missed collection can only be recorded while collection is pending',
    );
  }

  order.missedCollectionAttempts =
    Number(order.missedCollectionAttempts ?? 0) + 1;
  if (note?.trim()) order.note = note.trim();
  await order.save();
  await UserPenaltyService.recordMissedCollection(order.seller.toString());
  void NotificationEvent.collectionMissed(
    order,
    order.missedCollectionAttempts,
  );

  const threshold =
    config.penaltyPolicy.missedCollectionCancellationThreshold;
  if (order.missedCollectionAttempts < threshold) {
    return {
      order,
      cancelled: false,
      attemptsRemaining: threshold - order.missedCollectionAttempts,
    };
  }

  await refundOrderPayment(order, order.price);
  order.outcome = ORDER_OUTCOME.SELLER_UNAVAILABLE;
  order.status = ORDER_STATUS.CANCELLED;
  order.statusHistory.push({
    status: ORDER_STATUS.CANCELLED,
    note: note?.trim() || 'Cancelled after repeated missed collections',
    changedAt: new Date(),
    changedBy: adminId,
  } as any);
  await order.save();

  await synchronizeProductStatusMutation(
    Product.findByIdAndUpdate(order.product, {
      $set: { status: 'available' },
      $unset: { buyer: 1, reservationExpiresAt: 1 },
    }),
    { productId: order.product.toString(), status: 'available' },
  );
  void NotificationEvent.wishlistAvailabilityChanged(
    order.product.toString(),
    true,
    `${order._id.toString()}:missed-collection-cancelled`,
  );

  return { order, cancelled: true, attemptsRemaining: 0 };
};

const cancelOrder = async (orderId: string, buyerId: string) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  if (order.buyer.toString() !== buyerId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You don't have permission to cancel this order",
    );
  }

  if (
    order.status !== ORDER_STATUS.SECURED &&
    order.status !== ORDER_STATUS.PENDING_PAYMENT
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Order can only be cancelled before collection',
    );
  }

  if (order.status === ORDER_STATUS.PENDING_PAYMENT) {
    const cancelled = await Order.findOneAndUpdate(
      {
        _id: order._id,
        buyer: buyerId,
        status: ORDER_STATUS.PENDING_PAYMENT,
        'payment.status': PAYMENT_STATUS.PENDING,
      },
      {
        $set: { status: ORDER_STATUS.CANCELLED },
        $push: {
          statusHistory: {
            status: ORDER_STATUS.CANCELLED,
            changedAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!cancelled) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'The payment state changed; refresh the order and try again',
      );
    }
    await cancelPaymentIntent(cancelled.payment.paymentIntentId).catch(
      () => undefined,
    );
    await synchronizeProductStatusMutation(
      Product.findOneAndUpdate(
        { _id: cancelled.product, buyer: cancelled.buyer },
        {
          $set: { status: 'available' },
          $unset: { buyer: 1, reservationExpiresAt: 1 },
        },
      ),
      { productId: cancelled.product.toString(), status: 'available' },
    );
    void NotificationEvent.orderStatusChanged(
      cancelled,
      ORDER_STATUS.CANCELLED,
    );
    void NotificationEvent.wishlistAvailabilityChanged(
      cancelled.product.toString(),
      true,
      `${cancelled._id.toString()}:cancelled`,
    );
    return cancelled;
  }

  if (order.payment.status === PAYMENT_STATUS.PAID) {
    await createRefund(
      order.payment.paymentIntentId,
      `order-refund:${order._id.toString()}`,
    );
    order.payment.status = PAYMENT_STATUS.REFUNDED;
  }

  order.status = ORDER_STATUS.CANCELLED;
  order.statusHistory.push({
    status: ORDER_STATUS.CANCELLED,
    changedAt: new Date(),
  });
  await order.save();

  await synchronizeProductStatusMutation(
    Product.findByIdAndUpdate(order.product, {
      $set: { status: 'available' },
      $unset: { buyer: 1, reservationExpiresAt: 1 },
    }),
    { productId: order.product.toString(), status: 'available' },
  );

  void NotificationEvent.orderStatusChanged(order, ORDER_STATUS.CANCELLED);
  void NotificationEvent.wishlistAvailabilityChanged(
    order.product.toString(),
    true,
    `${order._id.toString()}:cancelled`,
  );

  return order;
};

const expirePendingOrders = async () => {
  const expired = await Order.find({
    status: ORDER_STATUS.PENDING_PAYMENT,
    createdAt: { $lte: new Date(Date.now() - 15 * 60 * 1000) },
  }).select('_id');

  for (const candidate of expired) {
    const order = await Order.findOneAndUpdate(
      { _id: candidate._id, status: ORDER_STATUS.PENDING_PAYMENT },
      {
        $set: { status: ORDER_STATUS.CANCELLED },
        $push: {
          statusHistory: {
            status: ORDER_STATUS.CANCELLED,
            note: 'Payment window expired',
            changedAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!order) continue;
    await cancelPaymentIntent(order.payment.paymentIntentId).catch(
      () => undefined,
    );
    await synchronizeProductStatusMutation(
      Product.findOneAndUpdate(
        { _id: order.product, buyer: order.buyer },
        {
          $set: { status: 'available' },
          $unset: { buyer: 1, reservationExpiresAt: 1 },
        },
      ),
      { productId: order.product.toString(), status: 'available' },
    );
    void NotificationEvent.orderStatusChanged(order, ORDER_STATUS.CANCELLED);
    void NotificationEvent.wishlistAvailabilityChanged(
      order.product.toString(),
      true,
      `${order._id.toString()}:expired`,
    );
  }
};

export const OrderService = {
  checkoutOrder,
  handlePaymentSucceeded,
  handlePaymentFailed,
  getMyOrders,
  getOrderById,
  updateOrderSchedule,
  getAllOrdersForAdmin,
  updateOrderStatus,
  markPayoutPaid,
  reportMissedCollection,
  cancelOrder,
  expirePendingOrders,
};
