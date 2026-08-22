import { model, Schema } from 'mongoose';
import { DEVICE_PLATFORM } from '../../../enums/notification';
import { IDeviceRegistration } from './notification.interface';

const deviceRegistrationSchema = new Schema<IDeviceRegistration>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    registrationToken: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORM),
      required: true,
    },
    deviceId: { type: String, trim: true, maxlength: 200 },
    lastSeenAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

deviceRegistrationSchema.index({ user: 1, lastSeenAt: -1 });

export const DeviceRegistration = model<IDeviceRegistration>(
  'DeviceRegistration',
  deviceRegistrationSchema,
);
