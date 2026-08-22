import { Types } from 'mongoose';
import { z } from 'zod';
import { DEVICE_PLATFORM } from '../../../enums/notification';

const registrationToken = z.string().trim().min(20).max(4096);

const listNotificationsZodSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      unread: z.enum(['true', 'false']).optional(),
    })
    .strict(),
});

const notificationIdZodSchema = z.object({
  params: z.object({
    id: z.string().refine(value => Types.ObjectId.isValid(value), {
      message: 'Invalid notification ID',
    }),
  }),
});

const registerDeviceZodSchema = z.object({
  body: z
    .object({
      registrationToken,
      platform: z.nativeEnum(DEVICE_PLATFORM),
      deviceId: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
});

const unregisterDeviceZodSchema = z.object({
  body: z.object({ registrationToken }).strict(),
});

export const NotificationValidation = {
  listNotificationsZodSchema,
  notificationIdZodSchema,
  registerDeviceZodSchema,
  unregisterDeviceZodSchema,
};
