/* eslint-disable no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { Issue } from './issue.model';
import { Product } from '../product/product.model';
import { Order } from '../order/order.model';
import { User } from '../user/user.model';
import {
  createRefund,
  reverseSellerTransfer,
} from '../../../integrations/stripe';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
} from '../../../enums/order';
import { emailHelper } from '../../../helpers/emailHelper';
import { emailTemplate } from '../../../shared/emailTemplate';
import { deleteFromS3 } from '../../../helpers/s3Helper';
import {
  invalidateProductListCache,
  synchronizeProductStatusMutation,
} from '../product/product-state-sync';
import { Types } from 'mongoose';
import { NotificationEvent } from '../notification/notification.event';
import { Wishlist } from '../wishlist/wishlist.model';

const createIssue = async (
  productId: string,
  issueType: string,
  reason: string,
  adminId: string,
) => {
  // Check for existing unresolved issue for product
  const existingIssue = await Issue.findOne({
    product: productId,
    resolved: false,
  });
  if (existingIssue) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'An unresolved issue already exists for this product',
    );
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  // Find associated order if any
  let order = null;
  if (product.buyer) {
    order = await Order.findOne({
      product: productId,
      buyer: product.buyer,
    });
  }

  // Refund buyer if payment was made
  const refunded = !!(order && order.payment.status === PAYMENT_STATUS.PAID);
  if (refunded && order) {
    if (order.payoutTransferId && order.payoutStatus === PAYOUT_STATUS.PAID) {
      const reversal = await reverseSellerTransfer(
        order.payoutTransferId,
        order.sellerPayout,
        order.orderNumber,
      );
      order.payoutReversalId = reversal.id;
      order.payoutStatus = PAYOUT_STATUS.REVERSED;
    }
    await createRefund(
      order.payment.paymentIntentId,
      `order-refund:${order._id.toString()}`,
    );
    order.payment.status = PAYMENT_STATUS.REFUNDED;
    order.status = ORDER_STATUS.REFUNDED;
    order.statusHistory.push({
      status: ORDER_STATUS.REFUNDED,
      note: 'Refunded because an issue was created',
      changedAt: new Date(),
      changedBy: new Types.ObjectId(adminId),
    });
    await order.save();
    void NotificationEvent.orderStatusChanged(order, ORDER_STATUS.REFUNDED);
  }

  // Create issue
  const issue = await Issue.create({
    product: productId,
    buyer: product.buyer,
    seller: product.seller,
    issueType,
    reason,
    admin: adminId,
  });
  if (order) {
    void NotificationEvent.issueCreated(issue._id.toString(), order);
  }

  // Notify seller
  const seller = await User.findById(product.seller);
  if (seller && seller.email) {
    const emailData = emailTemplate.issueCreated({
      email: seller.email,
      productName: product.name,
      issueType,
      reason,
      refunded,
    });
    await emailHelper.sendEmail(emailData);
  }

  return issue;
};

const resolveIssue = async (
  issueId: string,
  action: 'delete' | 'make_available',
  adminId: string,
) => {
  const issue = await Issue.findById(issueId).populate('product');
  if (!issue) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Issue not found');
  }
  if (issue.resolved) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Issue already resolved');
  }

  const product = await Product.findById(issue.product);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  const seller = await User.findById(product.seller);
  const order = await Order.findOne({ product: product._id }).sort({
    createdAt: -1,
  });
  const watcherIds = await Wishlist.distinct('user', { product: product._id });

  if (action === 'delete') {
    // Delete files from S3
    const productImages = product.images?.length
      ? product.images
      : product.image
        ? [product.image]
        : [];
    await Promise.all(productImages.map(image => deleteFromS3(image)));
    if (product.proofOfPurchase) {
      await deleteFromS3(product.proofOfPurchase);
    }

    // Delete product from DB
    await Product.findByIdAndDelete(product._id);
    await Wishlist.deleteMany({ product: product._id });
    void Promise.all(
      watcherIds.map(watcherId =>
        NotificationEvent.wishlistItemUnavailable(
          watcherId.toString(),
          product._id.toString(),
          product.name,
        ),
      ),
    );

    // Notify seller
    if (seller && seller.email) {
      const emailData = emailTemplate.issueResolved({
        email: seller.email,
        productName: product.name,
        action: 'delete',
      });
      await emailHelper.sendEmail(emailData);
    }
  } else if (action === 'make_available') {
    // Update product status and clear buyer
    await synchronizeProductStatusMutation(
      Product.findByIdAndUpdate(product._id, {
        $set: { status: 'available' },
        $unset: { buyer: 1, reservationExpiresAt: 1 },
      }),
      { productId: product._id.toString(), status: 'available' },
    );
    void NotificationEvent.wishlistAvailabilityChanged(
      product._id.toString(),
      true,
      `issue:${issue._id.toString()}:resolved`,
    );

    // Notify seller
    if (seller && seller.email) {
      const emailData = emailTemplate.issueResolved({
        email: seller.email,
        productName: product.name,
        action: 'make_available',
      });
      await emailHelper.sendEmail(emailData);
    }
  }

  // Mark issue as resolved
  issue.resolved = true;
  await issue.save();
  if (order) {
    void NotificationEvent.issueResolved(issue._id.toString(), order);
  }

  // Clear product cache
  invalidateProductListCache();

  return issue;
};

const getIssues = async () => {
  return Issue.find()
    .sort({ createdAt: -1 })
    .populate('product')
    .populate('seller')
    .populate('buyer')
    .populate('admin');
};

const getIssueById = async (issueId: string) => {
  const issue = await Issue.findById(issueId)
    .populate('product')
    .populate('seller')
    .populate('buyer')
    .populate('admin');
  if (!issue) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Issue not found');
  }
  return issue;
};

export const IssueService = {
  createIssue,
  resolveIssue,
  getIssues,
  getIssueById,
};
