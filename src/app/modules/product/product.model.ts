import { Schema, model } from 'mongoose';
import { IProduct } from './product.interface';

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true },
    images: {
      type: [String],
      required: true,
      validate: {
        validator: (images: string[]) => images.length >= 1 && images.length <= 4,
        message: 'A product must have between 1 and 4 images',
      },
    },
    // Transitional read support for records created before images[] was added.
    image: { type: String },
    brand: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    condition: { type: String, required: true },
    originalPackagingAvailable: { type: Boolean, required: true },
    proofOfPurchase: { type: String, default: null },
    status: {
      type: String,
      enum: ['available', 'secured', 'sold'],
      default: 'available',
    },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User' },
    reservationExpiresAt: { type: Date, default: null },
    orderId: { type: Number, required: true, unique: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_document, returned) => {
        if (
          (!returned.images || returned.images.length === 0) &&
          returned.image
        ) {
          returned.images = [returned.image];
        }
        delete returned.image;
        return returned;
      },
    },
  },
);

productSchema.index({ status: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ status: 1, reservationExpiresAt: 1 });

export const Product = model<IProduct>('Product', productSchema);
