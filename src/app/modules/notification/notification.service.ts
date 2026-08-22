import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import ApiError from '../../../errors/ApiError';
import { getFirebaseMessaging } from '../../../integrations/firebase';
import { socketHelper } from '../../../helpers/socketHelper';
import { errorLogger } from '../../../shared/logger';
import { DEVICE_PLATFORM } from '../../../enums/notification';
import { DeviceRegistration } from './device-registration.model';
import {
  ICreateNotification,
  INotification,
} from './notification.interface';
import { Notification } from './notification.model';

const PUSH_REGISTRATION_MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000;
const PUSH_BATCH_SIZE = 500;
const INVALID_REGISTRATION_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const normalizeData = (
  data: Map<string, string> | Record<string, string> | undefined,
) =>
  data instanceof Map
    ? Object.fromEntries(data.entries())
    : { ...(data ?? {}) };

export const toNotificationDto = (
  notification: INotification & { _id: unknown },
) => ({
  id: String(notification._id),
  type: notification.type,
  title: notification.title,
  body: notification.body,
  data: normalizeData(notification.data),
  isRead: Boolean(notification.readAt),
  readAt: notification.readAt ?? null,
  createdAt: notification.createdAt,
});

const sendPushNotification = async (
  recipientId: string,
  notification: ReturnType<typeof toNotificationDto>,
) => {
  const messaging = getFirebaseMessaging();
  if (!messaging) return;

  const staleBefore = new Date(Date.now() - PUSH_REGISTRATION_MAX_AGE_MS);
  await DeviceRegistration.deleteMany({
    user: recipientId,
    lastSeenAt: { $lt: staleBefore },
  });
  const registrations = await DeviceRegistration.find({
    user: recipientId,
    lastSeenAt: { $gte: staleBefore },
  }).select('+registrationToken');

  for (let index = 0; index < registrations.length; index += PUSH_BATCH_SIZE) {
    const batch = registrations.slice(index, index + PUSH_BATCH_SIZE);
    const tokens = batch.map(item => item.registrationToken);
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...notification.data,
        notificationId: notification.id,
        type: notification.type,
      },
      android: {
        priority: 'high',
        notification: { channelId: 'closete_updates', sound: 'default' },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    const invalidTokens = response.responses.flatMap((item, responseIndex) => {
      const code = item.error?.code;
      return code && INVALID_REGISTRATION_CODES.has(code)
        ? [tokens[responseIndex]]
        : [];
    });
    if (invalidTokens.length) {
      await DeviceRegistration.deleteMany({
        registrationToken: { $in: invalidTokens },
      });
    }
  }
};

const createNotification = async (payload: ICreateNotification) => {
  const result = await Notification.updateOne(
    { recipient: payload.recipientId, eventKey: payload.eventKey },
    {
      $setOnInsert: {
        recipient: payload.recipientId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        eventKey: payload.eventKey,
      },
    },
    { upsert: true },
  );
  if (!result.upsertedId) return null;

  const created = await Notification.findById(result.upsertedId).lean();
  if (!created) return null;
  const notification = toNotificationDto(created);
  socketHelper.emitToUser(
    payload.recipientId,
    'notification:new',
    notification,
  );
  void sendPushNotification(payload.recipientId, notification).catch(error => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errorLogger.error(`[FCM] Push delivery failed: ${message}`);
  });
  return notification;
};

const safeCreateNotification = async (payload: ICreateNotification) => {
  try {
    return await createNotification(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errorLogger.error(`[NOTIFICATION] Creation failed: ${message}`);
    return null;
  }
};

const getNotifications = async (
  userId: string,
  query: Record<string, unknown>,
) => {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const page = Math.max(Number(query.page) || 1, 1);
  const filter: Record<string, unknown> = { recipient: userId };
  if (query.unread === 'true') filter.readAt = null;
  if (query.unread === 'false') filter.readAt = { $ne: null };

  const [notifications, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  return {
    result: notifications.map(toNotificationDto),
    meta: { total, limit, page, totalPage: Math.ceil(total / limit) },
  };
};

const getUnreadCount = async (userId: string) => ({
  unreadCount: await Notification.countDocuments({
    recipient: userId,
    readAt: null,
  }),
});

const markAsRead = async (userId: string, notificationId: string) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { $set: { readAt: new Date() } },
    { new: true },
  ).lean();
  if (!notification) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found');
  }
  return toNotificationDto(notification);
};

const markAllAsRead = async (userId: string) => {
  const result = await Notification.updateMany(
    { recipient: userId, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return { updatedCount: result.modifiedCount };
};

const deleteNotification = async (userId: string, notificationId: string) => {
  const notification = await Notification.findOneAndDelete({
    _id: notificationId,
    recipient: userId,
  });
  if (!notification) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found');
  }
};

const deleteAllNotifications = async (userId: string) => {
  const result = await Notification.deleteMany({ recipient: userId });
  return { deletedCount: result.deletedCount };
};

const registerDevice = async (
  userId: string,
  registrationToken: string,
  platform: DEVICE_PLATFORM,
  deviceId?: string,
) => {
  await DeviceRegistration.findOneAndUpdate(
    { registrationToken },
    {
      $set: {
        user: new Types.ObjectId(userId),
        platform,
        deviceId: deviceId || undefined,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { registered: true };
};

const unregisterDevice = async (
  userId: string,
  registrationToken: string,
) => {
  await DeviceRegistration.deleteOne({
    user: userId,
    registrationToken,
  });
};

const deleteUserNotificationData = async (userId: string) => {
  await Promise.all([
    Notification.deleteMany({ recipient: userId }),
    DeviceRegistration.deleteMany({ user: userId }),
  ]);
};

export const NotificationService = {
  createNotification,
  safeCreateNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  registerDevice,
  unregisterDevice,
  deleteUserNotificationData,
};
