import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { Product } from '../product/product.model';
import { Wishlist } from './wishlist.model';
import { NotificationEvent } from '../notification/notification.event';
import { startSession } from 'mongoose';
import { publishProductWishlistCount } from '../product/product-state-sync';

type WishlistMutationResult = {
  wishlist: InstanceType<typeof Wishlist>;
  wishlistCount: number;
};

const addToWishlist = async (
  userId: string,
  productId: string,
): Promise<WishlistMutationResult> => {
  const session = await startSession();
  let outcome:
    | (WishlistMutationResult & {
        productName: string;
        changed: boolean;
        countChanged: boolean;
      })
    | undefined;

  try {
    outcome = await session.withTransaction(async () => {
      const product = await Product.findById(productId)
        .select('name wishlistCount')
        .session(session);
      if (!product) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
      }
      const existing = await Wishlist.findOne({
        user: userId,
        product: productId,
      }).session(session);

      let wishlist: InstanceType<typeof Wishlist>;
      let changed = false;
      if (existing) {
        wishlist = existing;
      } else {
        [wishlist] = await Wishlist.create(
          [{ user: userId, product: productId }],
          { session },
        );
        changed = true;
      }

      const wishlistCount = await Wishlist.countDocuments({
        product: productId,
      }).session(session);
      const countChanged = product.wishlistCount !== wishlistCount;
      const updatedProduct = await Product.updateOne(
        { _id: productId },
        { $set: { wishlistCount } },
        { session },
      );
      if (updatedProduct.matchedCount !== 1) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
      }

      return {
        wishlist,
        wishlistCount,
        productName: product.name,
        changed,
        countChanged,
      };
    });
  } finally {
    await session.endSession();
  }

  if (!outcome) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'Unable to update wishlist',
    );
  }

  if (outcome.changed || outcome.countChanged) {
    publishProductWishlistCount(productId, outcome.wishlistCount);
  }
  if (outcome.changed) {
    void NotificationEvent.wishlistItemSaved(
      userId,
      outcome.wishlist._id.toString(),
      productId,
      outcome.productName,
    );
  }
  return {
    wishlist: outcome.wishlist,
    wishlistCount: outcome.wishlistCount,
  };
};

const removeFromWishlist = async (
  userId: string,
  productId: string,
): Promise<WishlistMutationResult> => {
  const session = await startSession();
  let outcome: WishlistMutationResult | undefined;

  try {
    outcome = await session.withTransaction(async () => {
      const product = await Product.findById(productId)
        .select('_id')
        .session(session);
      if (!product) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
      }

      const wishlist = await Wishlist.findOneAndDelete({
        user: userId,
        product: productId,
      }).session(session);
      if (!wishlist) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Item not found in wishlist');
      }

      const wishlistCount = await Wishlist.countDocuments({
        product: productId,
      }).session(session);
      const updatedProduct = await Product.updateOne(
        { _id: productId },
        { $set: { wishlistCount } },
        { session },
      );
      if (updatedProduct.matchedCount !== 1) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
      }

      return { wishlist, wishlistCount };
    });
  } finally {
    await session.endSession();
  }

  if (!outcome) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'Unable to update wishlist',
    );
  }

  publishProductWishlistCount(productId, outcome.wishlistCount);
  return outcome;
};

const getMyWishlist = async (userId: string) => {
  const result = await Wishlist.find({ user: userId })
    .populate('product')
    .sort('-createdAt');
  return result;
};

export const WishlistService = {
  addToWishlist,
  removeFromWishlist,
  getMyWishlist,
};
