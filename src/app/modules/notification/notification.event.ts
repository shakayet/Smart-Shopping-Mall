import config from '../../../config';
import { ORDER_OUTCOME, ORDER_STATUS } from '../../../enums/order';
import { NOTIFICATION_TYPE } from '../../../enums/notification';
import { NotificationService } from './notification.service';
import { Product } from '../product/product.model';
import { Wishlist } from '../wishlist/wishlist.model';
import { errorLogger } from '../../../shared/logger';

type OrderNotificationContext = {
  _id: unknown;
  orderNumber: string;
  buyer: unknown;
  seller: unknown;
  product: unknown;
  price?: number;
};

const idOf = (value: unknown) => {
  if (value && typeof value === 'object' && '_id' in value) {
    return String((value as { _id: unknown })._id ?? '');
  }
  return String(value ?? '');
};

const formatPrice = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);

const getProductContext = async (productId: string, fallbackPrice = 0) => {
  try {
    const product = await Product.findById(productId).select('name price').lean();
    return {
      name: product?.name ?? 'item',
      price: Number(product?.price ?? fallbackPrice),
      currency: config.stripe.currency.toUpperCase(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errorLogger.error(`[NOTIFICATION] Product context lookup failed: ${message}`);
    return {
      name: 'item',
      price: fallbackPrice,
      currency: config.stripe.currency.toUpperCase(),
    };
  }
};

const orderData = (order: OrderNotificationContext) => ({
  screen: 'order_details',
  orderId: idOf(order._id),
  orderNumber: order.orderNumber,
  productId: idOf(order.product),
});

const notifyOrderParties = async (
  order: OrderNotificationContext,
  type: NOTIFICATION_TYPE,
  title: string,
  body: string,
  eventKey: string,
) => {
  const recipients = new Set([idOf(order.buyer), idOf(order.seller)]);
  recipients.delete('');
  await Promise.all(
    [...recipients].map(recipientId =>
      NotificationService.safeCreateNotification({
        recipientId,
        type,
        title,
        body,
        eventKey,
        data: orderData(order),
      }),
    ),
  );
};

const itemListed = async (sellerId: string, productId: string) =>
  NotificationService.safeCreateNotification({
    recipientId: sellerId,
    type: NOTIFICATION_TYPE.ITEM_LISTED,
    title: 'Your item is now live',
    body: 'Your listing is available for buyers to discover.',
    eventKey: `product:${productId}:listed`,
    data: { screen: 'product_details', productId },
  });

const paymentSucceeded = async (order: OrderNotificationContext) => {
  const key = `order:${idOf(order._id)}:payment-succeeded`;
  const product = await getProductContext(
    idOf(order.product),
    Number(order.price ?? 0),
  );
  const displayPrice = `${product.currency} ${formatPrice(product.price)}`;
  await Promise.all([
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.buyer),
      type: NOTIFICATION_TYPE.ORDER_SECURED,
      title: 'Order confirmed',
      body: `You’ve secured the ${product.name} for ${displayPrice}. We’ll arrange collection and begin authentication once the item is received.`,
      eventKey: key,
      data: orderData(order),
    }),
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.seller),
      type: NOTIFICATION_TYPE.ITEM_RESERVED,
      title: 'Your item has been reserved',
      body: `The ${product.name} has been purchased for ${displayPrice}. We’ll contact you shortly to arrange collection.`,
      eventKey: key,
      data: orderData(order),
    }),
  ]);
};

const authenticationPassed = async (order: OrderNotificationContext) => {
  const key = `order:${idOf(order._id)}:authentication-passed`;
  await Promise.all([
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.buyer),
      type: NOTIFICATION_TYPE.AUTHENTICATION_PASSED,
      title: 'Authentication complete',
      body: 'Your item has been authenticated and is being prepared for delivery.',
      eventKey: key,
      data: orderData(order),
    }),
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.seller),
      type: NOTIFICATION_TYPE.AUTHENTICATION_PASSED,
      title: 'Authentication complete',
      body: 'Your item has successfully passed authentication and will now be prepared for delivery.',
      eventKey: key,
      data: orderData(order),
    }),
  ]);
};

const authenticationFailed = async (
  order: OrderNotificationContext,
  outcome: ORDER_OUTCOME.AUTHENTICATION_FAILED | ORDER_OUTCOME.COUNTERFEIT,
) => {
  const key = `order:${idOf(order._id)}:authentication-failed:${outcome}`;
  await Promise.all([
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.buyer),
      type: NOTIFICATION_TYPE.AUTHENTICATION_FAILED,
      title: 'Authentication unsuccessful',
      body: 'Unfortunately this item did not pass our authentication process. A full refund has been issued to your original payment method.',
      eventKey: key,
      data: { ...orderData(order), outcome },
    }),
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.seller),
      type: NOTIFICATION_TYPE.AUTHENTICATION_FAILED,
      title: 'Authentication unsuccessful',
      body: 'Your item did not pass authentication and has been removed from Closete. Our team will contact you with the next steps.',
      eventKey: key,
      data: { ...orderData(order), outcome },
    }),
  ]);
};

const collectionMissed = async (
  order: OrderNotificationContext,
  attempt: number,
) =>
  NotificationService.safeCreateNotification({
    recipientId: idOf(order.seller),
    type: NOTIFICATION_TYPE.COLLECTION_MISSED,
    title: 'Collection missed',
    body: 'We were unable to collect your item. Our team will contact you to arrange another collection time.',
    eventKey: `order:${idOf(order._id)}:collection-missed:${attempt}`,
    data: { ...orderData(order), attempt: String(attempt) },
  });

const deliveryRejected = async (
  order: OrderNotificationContext,
  outcome:
    | ORDER_OUTCOME.NOT_AS_DESCRIBED
    | ORDER_OUTCOME.CONDITION_DIFFERS
    | ORDER_OUTCOME.BUYER_CHANGED_MIND,
) => {
  const messages = {
    [ORDER_OUTCOME.NOT_AS_DESCRIBED]: {
      buyerTitle: 'Delivery cancelled',
      buyerBody:
        'The item received did not match its description. Your payment has been refunded, less the applicable Closete handling fee.',
      sellerBody:
        'The buyer rejected your item because it differed from the original listing. Our team will contact you regarding the next steps.',
    },
    [ORDER_OUTCOME.CONDITION_DIFFERS]: {
      buyerTitle: 'Delivery cancelled',
      buyerBody:
        'The item’s condition did not match the listing. Your payment has been refunded, less the applicable Closete handling fee.',
      sellerBody:
        'The buyer rejected your item because its condition differed from the listing.',
    },
    [ORDER_OUTCOME.BUYER_CHANGED_MIND]: {
      buyerTitle: 'Order cancelled',
      buyerBody:
        'Your order has been cancelled at delivery. Your payment has been refunded, less the applicable Closete handling fee.',
      sellerBody: 'The buyer chose not to proceed with the purchase.',
    },
  } as const;
  const message = messages[outcome];
  const key = `order:${idOf(order._id)}:delivery-rejected:${outcome}`;
  await Promise.all([
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.buyer),
      type: NOTIFICATION_TYPE.DELIVERY_CANCELLED,
      title: message.buyerTitle,
      body: message.buyerBody,
      eventKey: key,
      data: { ...orderData(order), outcome },
    }),
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.seller),
      type: NOTIFICATION_TYPE.DELIVERY_CANCELLED,
      title: 'Delivery cancelled',
      body: message.sellerBody,
      eventKey: key,
      data: { ...orderData(order), outcome },
    }),
  ]);
};

const paymentFailed = async (order: OrderNotificationContext) =>
  NotificationService.safeCreateNotification({
    recipientId: idOf(order.buyer),
    type: NOTIFICATION_TYPE.PAYMENT_FAILED,
    title: 'Payment failed',
    body: `Payment for order ${order.orderNumber} was unsuccessful.`,
    eventKey: `order:${idOf(order._id)}:payment-failed`,
    data: orderData(order),
  });

const orderStatusChanged = async (
  order: OrderNotificationContext,
  status: ORDER_STATUS,
) => {
  if (status === ORDER_STATUS.PAYOUT_PROCESSING) {
    await authenticationPassed(order);
    return;
  }
  if (status === ORDER_STATUS.DELIVERED) {
    const key = `order:${idOf(order._id)}:status:${status}`;
    await Promise.all([
      NotificationService.safeCreateNotification({
        recipientId: idOf(order.buyer),
        type: NOTIFICATION_TYPE.ITEM_DELIVERED,
        title: 'Delivered',
        body: 'We hope you enjoy your purchase. Thank you for choosing Closete.',
        eventKey: key,
        data: orderData(order),
      }),
      NotificationService.safeCreateNotification({
        recipientId: idOf(order.seller),
        type: NOTIFICATION_TYPE.ITEM_DELIVERED,
        title: 'Delivery complete',
        body: 'Your item has been delivered successfully. Your payout will be processed shortly.',
        eventKey: key,
        data: orderData(order),
      }),
    ]);
    return;
  }
  const statusMessage: Partial<
    Record<ORDER_STATUS, [NOTIFICATION_TYPE, string, string]>
  > = {
    [ORDER_STATUS.SECURED]: [
      NOTIFICATION_TYPE.ORDER_SECURED,
      'Order secured',
      `Order ${order.orderNumber} has been secured.`,
    ],
    [ORDER_STATUS.COLLECTION_PENDING]: [
      NOTIFICATION_TYPE.COLLECTION_PENDING,
      'Collection pending',
      `Collection is being arranged for order ${order.orderNumber}.`,
    ],
    [ORDER_STATUS.COLLECTED]: [
      NOTIFICATION_TYPE.ITEM_COLLECTED,
      'Item collected',
      `The item for order ${order.orderNumber} has been collected.`,
    ],
    [ORDER_STATUS.VERIFICATION]: [
      NOTIFICATION_TYPE.ITEM_VERIFICATION,
      'Item authentication in progress',
      `The item for order ${order.orderNumber} is being authenticated.`,
    ],
    [ORDER_STATUS.READY_FOR_DELIVERY]: [
      NOTIFICATION_TYPE.READY_FOR_DELIVERY,
      'Ready for delivery',
      `Order ${order.orderNumber} is ready for delivery.`,
    ],
    [ORDER_STATUS.COMPLETED]: [
      NOTIFICATION_TYPE.ORDER_COMPLETED,
      'Order completed',
      `Order ${order.orderNumber} is complete.`,
    ],
    [ORDER_STATUS.REFUNDED]: [
      NOTIFICATION_TYPE.PAYMENT_REFUNDED,
      'Payment refunded',
      `Payment for order ${order.orderNumber} has been refunded.`,
    ],
    [ORDER_STATUS.CANCELLED]: [
      NOTIFICATION_TYPE.ORDER_CANCELLED,
      'Order cancelled',
      `Order ${order.orderNumber} has been cancelled.`,
    ],
  };
  const message = statusMessage[status];
  if (!message) return;
  await notifyOrderParties(
    order,
    message[0],
    message[1],
    message[2],
    `order:${idOf(order._id)}:status:${status}`,
  );
};

const payoutPaid = async (order: OrderNotificationContext) =>
  NotificationService.safeCreateNotification({
    recipientId: idOf(order.seller),
    type: NOTIFICATION_TYPE.PAYOUT_PAID,
    title: 'Payout released',
    body: 'Your funds are on their way to your nominated bank account.',
    eventKey: `order:${idOf(order._id)}:payout-paid`,
    data: orderData(order),
  });

const orderScheduleUpdated = async (
  order: OrderNotificationContext,
  version: string,
) =>
  notifyOrderParties(
    order,
    NOTIFICATION_TYPE.ORDER_SCHEDULE_UPDATED,
    'Order schedule updated',
    `The pickup or delivery schedule for order ${order.orderNumber} was updated.`,
    `order:${idOf(order._id)}:schedule:${version}`,
  );

const issueCreated = async (
  issueId: string,
  order: OrderNotificationContext,
) =>
  notifyOrderParties(
    order,
    NOTIFICATION_TYPE.ISSUE_CREATED,
    'Issue reported',
    `An issue was reported for order ${order.orderNumber}.`,
    `issue:${issueId}:created`,
  );

const issueResolved = async (
  issueId: string,
  order: OrderNotificationContext,
) =>
  notifyOrderParties(
    order,
    NOTIFICATION_TYPE.ISSUE_RESOLVED,
    'Issue resolved',
    `The issue for order ${order.orderNumber} has been resolved.`,
    `issue:${issueId}:resolved`,
  );

const wishlistItemSaved = async (
  userId: string,
  wishlistId: string,
  productId: string,
  productName: string,
) =>
  NotificationService.safeCreateNotification({
    recipientId: userId,
    type: NOTIFICATION_TYPE.WISHLIST_ITEM_SAVED,
    title: 'Added to Wishlist',
    body: `The ${productName} has been saved to your wishlist.`,
    eventKey: `wishlist:${wishlistId}:saved`,
    data: { screen: 'product_details', productId },
  });

const wishlistItemUpdated = async (
  userId: string,
  productId: string,
  productName: string,
  version: string,
) =>
  NotificationService.safeCreateNotification({
    recipientId: userId,
    type: NOTIFICATION_TYPE.WISHLIST_ITEM_UPDATED,
    title: 'Saved item updated',
    body: `${productName} has new listing information.`,
    eventKey: `product:${productId}:updated:${version}`,
    data: { screen: 'product_details', productId },
  });

const wishlistItemUnavailable = async (
  userId: string,
  productId: string,
  productName: string,
) =>
  NotificationService.safeCreateNotification({
    recipientId: userId,
    type: NOTIFICATION_TYPE.WISHLIST_ITEM_UNAVAILABLE,
    title: 'Saved item unavailable',
    body: `${productName} is no longer available.`,
    eventKey: `product:${productId}:unavailable`,
    data: { screen: 'wishlist', productId },
  });

const wishlistItemAvailable = async (
  userId: string,
  productId: string,
  productName: string,
  version: string,
) =>
  NotificationService.safeCreateNotification({
    recipientId: userId,
    type: NOTIFICATION_TYPE.WISHLIST_ITEM_AVAILABLE,
    title: 'Saved item available',
    body: `${productName} is available again.`,
    eventKey: `product:${productId}:available:${version}`,
    data: { screen: 'product_details', productId },
  });

const wishlistAvailabilityChanged = async (
  productId: string,
  available: boolean,
  version: string,
  excludedUserIds: string[] = [],
) => {
  try {
    const [product, watcherIds] = await Promise.all([
      Product.findById(productId).select('name').lean(),
      Wishlist.distinct('user', { product: productId }),
    ]);
    if (!product) return;
    const excluded = new Set(excludedUserIds);
    await Promise.all(
      watcherIds
        .map(watcherId => watcherId.toString())
        .filter(userId => !excluded.has(userId))
        .map(userId =>
          available
            ? wishlistItemAvailable(userId, productId, product.name, version)
            : NotificationService.safeCreateNotification({
                recipientId: userId,
                type: NOTIFICATION_TYPE.WISHLIST_ITEM_UNAVAILABLE,
                title: 'Saved item unavailable',
                body: `${product.name} has been reserved by another buyer.`,
                eventKey: `product:${productId}:unavailable:${version}`,
                data: { screen: 'wishlist', productId },
              }),
        ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errorLogger.error(
      `[NOTIFICATION] Wishlist availability update failed: ${message}`,
    );
  }
};

const sellerOnboardingRequired = async (userId: string) =>
  NotificationService.safeCreateNotification({
    recipientId: userId,
    type: NOTIFICATION_TYPE.SELLER_ONBOARDING_REQUIRED,
    title: 'Complete your seller details',
    body: 'Complete payout onboarding before creating product listings.',
    eventKey: `seller:${userId}:onboarding-required`,
    data: { screen: 'seller_onboarding' },
  });

export const NotificationEvent = {
  itemListed,
  paymentSucceeded,
  paymentFailed,
  orderStatusChanged,
  payoutPaid,
  orderScheduleUpdated,
  issueCreated,
  issueResolved,
  wishlistItemSaved,
  wishlistItemUpdated,
  wishlistItemUnavailable,
  wishlistItemAvailable,
  wishlistAvailabilityChanged,
  sellerOnboardingRequired,
  authenticationPassed,
  authenticationFailed,
  collectionMissed,
  deliveryRejected,
};
