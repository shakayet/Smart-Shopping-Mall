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
import QueryBuilder from '../../builder/QueryBuilder';
import { Product } from '../product/product.model';
import {
  ORDER_STATUS_TRANSITIONS,
  REFUND_TRIGGER_STATUSES,
} from './order.constant';
import { IDeliveryDetails } from './order.interface';
import { Order } from './order.model';

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

  if (
    product.status !== 'available' &&
    (!product.reservationExpiresAt ||
      product.reservationExpiresAt.getTime() > Date.now())
  ) {
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
      $or: [
        { status: 'available' },
        { status: 'secured', reservationExpiresAt: { $lte: new Date() } },
      ],
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

const handlePaymentSucceeded = async (paymentIntentId: string) => {
  const order = await Order.findOneAndUpdate(
    {
      'payment.paymentIntentId': paymentIntentId,
      'payment.status': PAYMENT_STATUS.PENDING,
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

const markPayoutPaid = async (orderId: string) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  if (
    order.status === ORDER_STATUS.PENDING_PAYMENT ||
    order.status === ORDER_STATUS.SECURED ||
    order.status === ORDER_STATUS.COLLECTION_PENDING ||
    order.status === ORDER_STATUS.COLLECTED ||
    order.status === ORDER_STATUS.VERIFICATION ||
    order.status === ORDER_STATUS.REFUNDED ||
    order.status === ORDER_STATUS.CANCELLED
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Payout can only be marked once the item has passed verification',
    );
  }

  order.payoutStatus = PAYOUT_STATUS.PAID;
  await order.save();
  return order;
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

  if (order.status !== ORDER_STATUS.SECURED) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Order can only be cancelled before it has been collected for verification',
    );
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
};
