import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { NotificationService } from './notification.service';

const getNotifications = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.getNotifications(
    (req.user as JwtPayload).id,
    req.query,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Notifications retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.getUnreadCount(
    (req.user as JwtPayload).id,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Unread notification count retrieved successfully',
    data: result,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.markAsRead(
    (req.user as JwtPayload).id,
    req.params.id,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Notification marked as read',
    data: result,
  });
});

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.markAllAsRead(
    (req.user as JwtPayload).id,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'All notifications marked as read',
    data: result,
  });
});

const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  await NotificationService.deleteNotification(
    (req.user as JwtPayload).id,
    req.params.id,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Notification deleted successfully',
    data: null,
  });
});

const deleteAllNotifications = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationService.deleteAllNotifications(
      (req.user as JwtPayload).id,
    );
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'All notifications deleted successfully',
      data: result,
    });
  },
);

const registerDevice = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.registerDevice(
    (req.user as JwtPayload).id,
    req.body.registrationToken,
    req.body.platform,
    req.body.deviceId,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Push notification device registered successfully',
    data: result,
  });
});

const unregisterDevice = catchAsync(async (req: Request, res: Response) => {
  await NotificationService.unregisterDevice(
    (req.user as JwtPayload).id,
    req.body.registrationToken,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Push notification device unregistered successfully',
    data: null,
  });
});

export const NotificationController = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  registerDevice,
  unregisterDevice,
};
