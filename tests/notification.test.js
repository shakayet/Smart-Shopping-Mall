const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEVICE_PLATFORM,
  NOTIFICATION_TYPE,
} = require('../dist/enums/notification.js');
const {
  toNotificationDto,
} = require('../dist/app/modules/notification/notification.service.js');
const {
  NotificationValidation,
} = require('../dist/app/modules/notification/notification.validation.js');

test('notification DTO exposes only the client contract', () => {
  const createdAt = new Date('2026-08-22T00:00:00.000Z');
  const dto = toNotificationDto({
    _id: 'notification-1',
    recipient: 'user-1',
    type: NOTIFICATION_TYPE.ORDER_SECURED,
    title: 'Order secured',
    body: 'Your order has been secured.',
    data: new Map([['orderId', 'order-1']]),
    eventKey: 'internal-event-key',
    readAt: null,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    createdAt,
    updatedAt: createdAt,
  });

  assert.deepEqual(dto, {
    id: 'notification-1',
    type: NOTIFICATION_TYPE.ORDER_SECURED,
    title: 'Order secured',
    body: 'Your order has been secured.',
    data: { orderId: 'order-1' },
    isRead: false,
    readAt: null,
    createdAt,
  });
  assert.equal('recipient' in dto, false);
  assert.equal('eventKey' in dto, false);
});

test('device registration validates platform, token length, and extra data', () => {
  const valid = NotificationValidation.registerDeviceZodSchema.safeParse({
    body: {
      registrationToken: 'a'.repeat(64),
      platform: DEVICE_PLATFORM.ANDROID,
      deviceId: 'installation-1',
    },
  });
  assert.equal(valid.success, true);

  const invalid = NotificationValidation.registerDeviceZodSchema.safeParse({
    body: {
      registrationToken: 'short',
      platform: 'desktop',
      unexpected: true,
    },
  });
  assert.equal(invalid.success, false);
});

test('notification pagination is bounded and unread filter is explicit', () => {
  assert.equal(
    NotificationValidation.listNotificationsZodSchema.safeParse({
      query: { page: '1', limit: '100', unread: 'true' },
    }).success,
    true,
  );
  assert.equal(
    NotificationValidation.listNotificationsZodSchema.safeParse({
      query: { limit: '101' },
    }).success,
    false,
  );
});
