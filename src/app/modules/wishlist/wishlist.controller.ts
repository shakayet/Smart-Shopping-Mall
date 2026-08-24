/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { WishlistService } from './wishlist.service';

const addToWishlist = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await WishlistService.addToWishlist(user.id, req.params.productId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Product added to wishlist',
    data: {
      ...result.wishlist.toJSON(),
      wishlistCount: result.wishlistCount,
    },
  });
});

const removeFromWishlist = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await WishlistService.removeFromWishlist(
    user.id,
    req.params.productId,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Product removed from wishlist',
    data: {
      productId: req.params.productId,
      wishlistCount: result.wishlistCount,
    },
  });
});

const getMyWishlist = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await WishlistService.getMyWishlist(user.id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Wishlist retrieved successfully',
    data: result,
  });
});

export const WishlistController = {
  addToWishlist,
  removeFromWishlist,
  getMyWishlist,
};
