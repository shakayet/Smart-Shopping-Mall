/* eslint-disable @typescript-eslint/consistent-type-definitions */
import { Types } from 'mongoose';

export type IProductStatus =
  | 'available'
  | 'secured'
  | 'sold'
  | 'under_review';

export interface IProduct {
  name: string;
  images: string[];
  /** @deprecated Read-only compatibility for products created before images[]. */
  image?: string;
  brand: string;
  description: string;
  material?: string;
  features?: string[];
  price: number;
  condition: string;
  originalPackagingAvailable: boolean;
  proofOfPurchase?: string | null;
  status: IProductStatus;
  wishlistCount: number;
  seller: Types.ObjectId;
  orderId: number;
  buyer?: Types.ObjectId;
  reservationExpiresAt?: Date;
}
