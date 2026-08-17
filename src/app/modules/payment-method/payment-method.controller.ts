import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { PaymentMethodService } from './payment-method.service';

const getPaymentMethods = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentMethodService.getPaymentMethods(
    (req.user as JwtPayload).id,
    req.query,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Payment methods retrieved successfully',
    data: result,
  });
});

const createSetupIntent = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentMethodService.createSetupIntent(
    (req.user as JwtPayload).id,
    req.get('Idempotency-Key'),
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Setup intent created successfully',
    data: result,
  });
});

const deletePaymentMethod = catchAsync(async (req: Request, res: Response) => {
  await PaymentMethodService.deletePaymentMethod(
    (req.user as JwtPayload).id,
    req.params.id,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Payment method removed successfully',
    data: null,
  });
});

export const PaymentMethodController = {
  getPaymentMethods,
  createSetupIntent,
  deletePaymentMethod,
};
