import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import { notificationDeviceLimiter } from '../../middlewares/rateLimiter';
import validateRequest from '../../middlewares/validateRequest';
import { NotificationController } from './notification.controller';
import { NotificationValidation } from './notification.validation';

const router = express.Router();

router.use(auth(USER_ROLES.USER));

router.get(
  '/',
  validateRequest(NotificationValidation.listNotificationsZodSchema),
  NotificationController.getNotifications,
);
router.get('/unread-count', NotificationController.getUnreadCount);
router.patch('/read-all', NotificationController.markAllAsRead);
router.delete('/all', NotificationController.deleteAllNotifications);
router.post(
  '/devices',
  notificationDeviceLimiter,
  validateRequest(NotificationValidation.registerDeviceZodSchema),
  NotificationController.registerDevice,
);
router.delete(
  '/devices',
  notificationDeviceLimiter,
  validateRequest(NotificationValidation.unregisterDeviceZodSchema),
  NotificationController.unregisterDevice,
);
router.patch(
  '/:id/read',
  validateRequest(NotificationValidation.notificationIdZodSchema),
  NotificationController.markAsRead,
);
router.delete(
  '/:id',
  validateRequest(NotificationValidation.notificationIdZodSchema),
  NotificationController.deleteNotification,
);

export const NotificationRoutes = router;
