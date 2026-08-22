import { ORDER_STATUS } from '../../../enums/order';
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
};

const idOf = (value: unknown) => String(value ?? '');

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

const paymentSucceeded = async (order: OrderNotificationContext) => {
  const key = `order:${idOf(order._id)}:payment-succeeded`;
  await Promise.all([
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.buyer),
      type: NOTIFICATION_TYPE.ORDER_SECURED,
      title: 'Order secured',
      body: `Your order ${order.orderNumber} has been secured.`,
      eventKey: key,
      data: orderData(order),
    }),
    NotificationService.safeCreateNotification({
      recipientId: idOf(order.seller),
      type: NOTIFICATION_TYPE.ITEM_RESERVED,
      title: 'Your item was reserved',
      body: `A buyer reserved your item in order ${order.orderNumber}.`,
      eventKey: key,
      data: orderData(order),
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
    [ORDER_STATUS.PAYOUT_PROCESSING]: [
      NOTIFICATION_TYPE.PAYOUT_PROCESSING,
      'Seller payout processing',
      `Seller payout for order ${order.orderNumber} is processing.`,
    ],
    [ORDER_STATUS.READY_FOR_DELIVERY]: [
      NOTIFICATION_TYPE.READY_FOR_DELIVERY,
      'Ready for delivery',
      `Order ${order.orderNumber} is ready for delivery.`,
    ],
    [ORDER_STATUS.DELIVERED]: [
      NOTIFICATION_TYPE.ITEM_DELIVERED,
      'Order delivered',
      `Order ${order.orderNumber} has been delivered.`,
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
    title: 'Seller payout sent',
    body: `Your payout for order ${order.orderNumber} has been sent.`,
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
    title: 'New item saved',
    body: `${productName} was added to your saved items.`,
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
};
