import { Types } from 'mongoose';
import { ORDER_STATUS, PAYMENT_STATUS, PAYOUT_STATUS } from '../../../enums/order';

export type IDeliveryDetails = {
  address: string;
  location: string;
  phone: string;
}

export type IPickupWindow = {
  start: Date;
  end: Date;
};

export type IOrderStatusHistory = {
  status: ORDER_STATUS;
  note?: string;
  changedAt: Date;
  changedBy?: Types.ObjectId;
}

export type IOrderPayment = {
  provider: 'stripe';
  paymentIntentId: string;
  status: PAYMENT_STATUS;
}

export type IOrder = {
  orderNumber: string;
  product: Types.ObjectId;
  buyer: Types.ObjectId;
  seller: Types.ObjectId;
  price: number;
  platformFee: number;
  sellerPayout: number;
  note?: string;
  pickupWindow?: IPickupWindow;
  estimatedDeliveryAt?: Date;
  deliveryDetails: IDeliveryDetails;
  payment: IOrderPayment;
  payoutStatus: PAYOUT_STATUS;
  payoutTransferId?: string;
  payoutReversalId?: string;
  payoutFailureReason?: string;
  status: ORDER_STATUS;
  statusHistory: IOrderStatusHistory[];
}
