import { model, Schema } from 'mongoose';
import { NOTIFICATION_TYPE } from '../../../enums/notification';
import { INotification } from './notification.interface';

const notificationSchema = new Schema<INotification>(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPE),
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    data: { type: Map, of: String, default: {} },
    eventKey: { type: String, required: true, maxlength: 200 },
    readAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true },
);

notificationSchema.index(
  { recipient: 1, eventKey: 1 },
  { unique: true },
);
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Notification = model<INotification>(
  'Notification',
  notificationSchema,
);
