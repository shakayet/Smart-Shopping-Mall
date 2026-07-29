/* eslint-disable @typescript-eslint/no-explicit-any */
import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import config from '../../../config';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
} from '../../../enums/order';
import { USER_ROLES } from '../../../enums/user';
import ApiError from '../../../errors/ApiError';
import {
  cancelPaymentIntent,
  createPaymentIntent,
  createRefund,
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

const generateOrderNumber = () => {
  const random = Math.floor(100 + Math.random() * 900);
  return `CLT-${Date.now().toString().slice(-8)}${random}`;
};

const checkoutOrder = async (
  productId: string,
  buyerId: string,
  deliveryDetails: IDeliveryDetails,
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
  const reservedProduct = await Product.findOneAndUpdate(
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
  );
  if (!reservedProduct) {
    throw new ApiError(StatusCodes.CONFLICT, 'This item is being purchased');
  }

  let paymentIntent: Awaited<ReturnType<typeof createPaymentIntent>> | undefined;
  try {
    paymentIntent = await createPaymentIntent(
      product.price,
      {
        orderNumber,
        productId: String(product._id),
        buyerId,
      },
      `checkout:${orderNumber}`,
    );

    const order = await Order.create({
    orderNumber,
    product: product._id,
    buyer: buyerId,
    seller: product.seller,
    price: product.price,
    platformFee,
    sellerPayout,
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
    await Product.findOneAndUpdate(
      { _id: product._id, buyer: buyerId, reservationExpiresAt },
      {
        $set: { status: 'available' },
        $unset: { buyer: 1, reservationExpiresAt: 1 },
      },
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
    await Product.findOneAndUpdate(
      { _id: expectedOrder.product, buyer: expectedOrder.buyer },
      {
        $set: { status: 'available' },
        $unset: { buyer: 1, reservationExpiresAt: 1 },
      },
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
    }
    return;
  }

  await Product.findByIdAndUpdate(order.product, {
    $set: { status: 'secured', buyer: order.buyer },
    $unset: { reservationExpiresAt: 1 },
  });
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
  await Product.findOneAndUpdate(
    { _id: order.product, buyer: order.buyer, status: 'secured' },
    {
      $set: { status: 'available' },
      $unset: { buyer: 1, reservationExpiresAt: 1 },
    },
  );
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
    .populate('buyer', 'name email contact location')
    .populate('seller', 'name email contact location');

  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  const isAdmin =
    user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPER_ADMIN;
  const isParty =
    order.buyer._id?.toString() === user.id ||
    order.seller._id?.toString() === user.id;

  if (!isAdmin && !isParty) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You don't have permission to view this order",
    );
  }

  return order;
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

const updateOrderStatus = async (
  orderId: string,
  targetStatus: ORDER_STATUS,
  note: string | undefined,
  adminId: string,
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

  if (REFUND_TRIGGER_STATUSES.includes(targetStatus)) {
    if (order.payment.status === PAYMENT_STATUS.PAID) {
      await createRefund(
        order.payment.paymentIntentId,
        `order-refund:${order._id.toString()}`,
      );
      order.payment.status = PAYMENT_STATUS.REFUNDED;
    }
    await Product.findByIdAndUpdate(order.product, {
      status: 'available',
      buyer: undefined,
    });
  }

  if (targetStatus === ORDER_STATUS.PAYOUT_PROCESSING) {
    await paySeller(order);
  }

  if (
    targetStatus === ORDER_STATUS.COMPLETED ||
    targetStatus === ORDER_STATUS.DELIVERED
  ) {
    await Product.findByIdAndUpdate(order.product, { status: 'sold' });
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
  return order;
};

const paySeller = async (order: InstanceType<typeof Order>) => {
  if (order.payoutStatus === PAYOUT_STATUS.PAID) return order;
  if (
    order.status !== ORDER_STATUS.VERIFICATION &&
    order.status !== ORDER_STATUS.PAYOUT_PROCESSING
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Seller payout is only available after verification',
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
    await Product.findOneAndUpdate(
      { _id: cancelled.product, buyer: cancelled.buyer },
      {
        $set: { status: 'available' },
        $unset: { buyer: 1, reservationExpiresAt: 1 },
      },
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

  await Product.findByIdAndUpdate(order.product, {
    status: 'available',
    buyer: undefined,
  });

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
    await Product.findOneAndUpdate(
      { _id: order.product, buyer: order.buyer },
      {
        $set: { status: 'available' },
        $unset: { buyer: 1, reservationExpiresAt: 1 },
      },
    );
  }
};

export const OrderService = {
  checkoutOrder,
  handlePaymentSucceeded,
  handlePaymentFailed,
  getMyOrders,
  getOrderById,
  getAllOrdersForAdmin,
  updateOrderStatus,
  markPayoutPaid,
  cancelOrder,
  expirePendingOrders,
};
