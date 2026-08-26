/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { OrderService } from './order.service';

const checkoutOrder = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const { deliveryDetails, note } = req.body;

  const result = await OrderService.checkoutOrder(
    req.params.productId,
    user.id,
    deliveryDetails,
    note,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Order created, complete payment to secure this item',
    data: result,
  });
});

const getMyOrders = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const role = req.query.role === 'seller' ? 'seller' : 'buyer';

  const result = await OrderService.getMyOrders(user.id, role, req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Orders retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});

const getOrderDetails = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await OrderService.getOrderById(req.params.id, user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Order details retrieved successfully',
    data: result,
  });
});

const getAllOrdersForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderService.getAllOrdersForAdmin(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Orders retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});

const updateOrderStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const { status, note, outcome } = req.body;

  const result = await OrderService.updateOrderStatus(
    req.params.id,
    status,
    note,
    user.id,
    outcome,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Order status updated successfully',
    data: result,
  });
});

const updateOrderSchedule = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await OrderService.updateOrderSchedule(
    req.params.id,
    req.body,
    user,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Order schedule updated successfully',
    data: result,
  });
});

const markPayoutPaid = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderService.markPayoutPaid(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Seller payout marked as paid',
    data: result,
  });
});

const reportMissedCollection = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;
    const result = await OrderService.reportMissedCollection(
      req.params.id,
      user.id,
      req.body.note,
    );

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: result.cancelled
        ? 'Order cancelled after repeated missed collections'
        : 'Missed collection recorded',
      data: result,
    });
  },
);

const cancelOrder = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await OrderService.cancelOrder(req.params.id, user.id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Order cancelled successfully',
    data: result,
  });
});

export const OrderController = {
  checkoutOrder,
  getMyOrders,
  getOrderDetails,
  getAllOrdersForAdmin,
  updateOrderStatus,
  updateOrderSchedule,
  markPayoutPaid,
  reportMissedCollection,
  cancelOrder,
};
