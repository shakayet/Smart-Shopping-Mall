import { Types } from 'mongoose';
import { ORDER_STATUS, PAYMENT_STATUS, PAYOUT_STATUS } from '../../../enums/order';

export interface IDeliveryDetails {
  address: string;
  location: string;
  phone: string;
}

export interface IOrderStatusHistory {
  status: ORDER_STATUS;
  note?: string;
  changedAt: Date;
  changedBy?: Types.ObjectId;
}

export interface IOrderPayment {
  provider: 'stripe';
  paymentIntentId: string;
  status: PAYMENT_STATUS;
}

export interface IOrder {
  orderNumber: string;
  product: Types.ObjectId;
  buyer: Types.ObjectId;
  seller: Types.ObjectId;
  price: number;
  platformFee: number;
  sellerPayout: number;
  deliveryDetails: IDeliveryDetails;
  payment: IOrderPayment;
  payoutStatus: PAYOUT_STATUS;
  status: ORDER_STATUS;
  statusHistory: IOrderStatusHistory[];
}
