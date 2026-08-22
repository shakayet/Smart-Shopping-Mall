import { Types } from 'mongoose';
import {
  DEVICE_PLATFORM,
  NOTIFICATION_TYPE,
} from '../../../enums/notification';

export type INotification = {
  recipient: Types.ObjectId;
  type: NOTIFICATION_TYPE;
  title: string;
  body: string;
  data: Map<string, string> | Record<string, string>;
  eventKey: string;
  readAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type IDeviceRegistration = {
  user: Types.ObjectId;
  registrationToken: string;
  platform: DEVICE_PLATFORM;
  deviceId?: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ICreateNotification = {
  recipientId: string;
  type: NOTIFICATION_TYPE;
  title: string;
  body: string;
  eventKey: string;
  data?: Record<string, string>;
};
