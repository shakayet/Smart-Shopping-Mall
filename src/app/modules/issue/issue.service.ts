/* eslint-disable no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { Issue } from './issue.model';
import { Product } from '../product/product.model';
import { Order } from '../order/order.model';
import { User } from '../user/user.model';
import { createRefund } from '../../../integrations/stripe';
import { PAYMENT_STATUS } from '../../../enums/order';
import { emailHelper } from '../../../helpers/emailHelper';
import config from '../../../config';
import { deleteFromS3 } from '../../../helpers/s3Helper';
import { cache } from '../../../helpers/cache';
import { PRODUCT_LIST_CACHE_PREFIX } from '../product/product.service';

const notifySeller = async (
  sellerEmail: string,
  subject: string,
  bodyContent: string,
) => {
  const projectName = config.branding.projectName;
  const baseTemplate = (title: string, content: string) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <style>
      body { margin: 0; padding: 0; background-color: #ffffff; }
      .wrapper { width: 100%; table-layout: fixed; background-color: #ffffff; padding: 24px 0; }
      .main { width: 100%; max-width: 480px; margin: 0 auto; background-color: #050816; border-radius: 16px; border: 1px solid #111827; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #e5e7eb; }
      .header { padding: 32px 24px 16px; text-align: center; }
      .brand-name { font-size: 22px; font-weight: 600; letter-spacing: 0.04em; }
      .logo { display: block; margin: 0 auto 24px; max-width: 80px; height: auto; border-radius: 12px; }
      .header-divider { margin: 12px auto 0; width: 100%; max-width: 80%; height: 1px; background: linear-gradient(to right, transparent, #1d4ed8, transparent); }
      .content { padding: 8px 24px 24px; font-size: 14px; line-height: 1.6; text-align: center; }
      .content-title { font-size: 22px; font-weight: 600; margin: 0 0 12px; color: #f9fafb; }
      .footer { padding: 16px 24px 24px; font-size: 12px; color: #9ca3af; text-align: center; border-top: 1px solid #111827; }
    </style>
  </head>
  <body>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="wrapper">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="main">
            <tr>
              <td class="header">
                ${config.branding.logoUrl ? `<img src="${config.branding.logoUrl}" alt="${projectName} logo" class="logo" />` : `<div class="brand-name">${projectName}</div>`}
                <div class="header-divider"></div>
              </td>
            </tr>
            <tr>
              <td class="content">
                <h1 class="content-title">${title}</h1>
                ${content}
              </td>
            </tr>
            <tr>
              <td class="footer">
                <div>You are receiving this email from ${projectName}.</div>
                <div>© ${new Date().getFullYear()} ${projectName}. All rights reserved.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  await emailHelper.sendEmail({
    to: sellerEmail,
    subject: `${projectName} - ${subject}`,
    html: baseTemplate(subject, bodyContent),
  });
};

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
    throw new ApiError(StatusCodes.BAD_REQUEST, 'An unresolved issue already exists for this product');
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
  if (order && order.payment.status === PAYMENT_STATUS.PAID) {
    await createRefund(order.payment.paymentIntentId);
    order.payment.status = PAYMENT_STATUS.REFUNDED;
    await order.save();
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

  // Notify seller
  const seller = await User.findById(product.seller);
  if (seller && seller.email) {
    const issueTypeLabel = issueType === 'buyer_refused' ? 'Buyer Refused to Collect' : 'Verification Failed';
    await notifySeller(
      seller.email,
      'Product Issue Reported',
      `
        <p style="margin: 0 0 10px; color: #d1d5db;">
          An issue has been reported for your product "${product.name}".
        </p>
        <p style="margin: 8px 0; color: #d1d5db;">
          Issue Type: <strong style="color: #f9fafb;">${issueTypeLabel}</strong>
        </p>
        <p style="margin: 8px 0; color: #d1d5db;">
          Reason: <span style="color: #9ca3af;">${reason}</span>
        </p>
        ${order && order.payment.status === PAYMENT_STATUS.REFUNDED ? `
          <p style="margin: 8px 0; color: #d1d5db;">
            The buyer has been fully refunded.
          </p>
        ` : ''}
        <p style="margin: 16px 0 0; color: #6b7280;">
          Our admin team will take final action on this product shortly.
        </p>
      `,
    );
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

  if (action === 'delete') {
    // Delete files from S3
    await deleteFromS3(product.image);
    if (product.proofOfPurchase) {
      await deleteFromS3(product.proofOfPurchase);
    }

    // Delete product from DB
    await Product.findByIdAndDelete(product._id);

    // Notify seller
    if (seller && seller.email) {
      await notifySeller(
        seller.email,
        'Product Deleted',
        `
          <p style="margin: 0 0 10px; color: #d1d5db;">
            Your product "${product.name}" has been permanently deleted from ${config.branding.projectName}.
          </p>
          <p style="margin: 16px 0 0; color: #6b7280;">
            If you have questions, please contact our support team.
          </p>
        `,
      );
    }
  } else if (action === 'make_available') {
    // Update product status and clear buyer
    product.status = 'available';
    product.buyer = undefined;
    await product.save();

    // Notify seller
    if (seller && seller.email) {
      await notifySeller(
        seller.email,
        'Product Back Online',
        `
          <p style="margin: 0 0 10px; color: #d1d5db;">
            Great news! Your product "${product.name}" has been marked as available again on ${config.branding.projectName}.
          </p>
          <p style="margin: 16px 0 0; color: #6b7280;">
            It can now be purchased by other buyers.
          </p>
        `,
      );
    }
  }

  // Mark issue as resolved
  issue.resolved = true;
  await issue.save();

  // Clear product cache
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);

  return issue;
};

const getIssues = async () => {
  return Issue.find().sort({ createdAt: -1 }).populate('product').populate('seller').populate('buyer').populate('admin');
};

const getIssueById = async (issueId: string) => {
  const issue = await Issue.findById(issueId).populate('product').populate('seller').populate('buyer').populate('admin');
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
