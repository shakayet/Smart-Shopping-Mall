import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { Product } from '../product/product.model';
import { Wishlist } from './wishlist.model';

const addToWishlist = async (userId: string, productId: string) => {
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  const existing = await Wishlist.findOne({ user: userId, product: productId });
  if (existing) {
    return existing;
  }

  const result = await Wishlist.create({ user: userId, product: productId });
  return result;
};

const removeFromWishlist = async (userId: string, productId: string) => {
  const result = await Wishlist.findOneAndDelete({
    user: userId,
    product: productId,
  });
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Item not found in wishlist');
  }
  return result;
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
