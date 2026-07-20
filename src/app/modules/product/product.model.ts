import { Schema, model } from 'mongoose';
import { IProduct } from './product.interface';

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true },
    image: { type: String, required: true },
    brand: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    condition: { type: String, required: true },
    proofOfPurchase: { type: String },
    status: {
      type: String,
      enum: ['available', 'secured', 'sold'],
      default: 'available',
    },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Number, required: true, unique: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  },
);

productSchema.index({ status: 1 });
productSchema.index({ seller: 1 });

export const Product = model<IProduct>('Product', productSchema);
