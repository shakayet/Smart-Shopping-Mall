import { Schema, model } from 'mongoose';
import { ORDER_STATUS, PAYMENT_STATUS, PAYOUT_STATUS } from '../../../enums/order';
import { IOrder } from './order.interface';

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    price: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    sellerPayout: { type: Number, required: true },
    deliveryDetails: {
      address: { type: String, required: true },
      location: { type: String, required: true },
      phone: { type: String, required: true },
    },
    payment: {
      provider: { type: String, enum: ['stripe'], default: 'stripe' },
      paymentIntentId: { type: String, required: true },
      status: {
        type: String,
        enum: Object.values(PAYMENT_STATUS),
        default: PAYMENT_STATUS.PENDING,
      },
    },
    payoutStatus: {
      type: String,
      enum: Object.values(PAYOUT_STATUS),
      default: PAYOUT_STATUS.PENDING,
    },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING_PAYMENT,
    },
    statusHistory: [
      {
        status: { type: String, enum: Object.values(ORDER_STATUS), required: true },
        note: { type: String },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true },
);

export const Order = model<IOrder>('Order', orderSchema);
