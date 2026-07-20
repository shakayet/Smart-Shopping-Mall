/* eslint-disable @typescript-eslint/consistent-type-definitions */
import { Types } from 'mongoose';

export type IProductStatus = 'available' | 'secured' | 'sold';

export interface IProduct {
  name: string;
  image: string;
  brand: string;
  description: string;
  price: number;
  condition: string;
  proofOfPurchase?: string;
  status: IProductStatus;
  seller: Types.ObjectId;
  orderId: number;
  buyer?: Types.ObjectId;
}
