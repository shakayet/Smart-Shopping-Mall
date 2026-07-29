import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import config from '../../../config';
import catchAsync from '../../../shared/catchAsync';
import { stripeClient } from '../../../integrations/stripe';
import { logger } from '../../../shared/logger';
import { OrderService } from '../order/order.service';
import { ConnectService } from './connect.service';
import { JwtPayload } from 'jsonwebtoken';

const stripeWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;

  let event: ReturnType<typeof stripeClient.webhooks.constructEvent>;
  try {
    event = stripeClient.webhooks.constructEvent(
      req.body,
      signature,
      config.stripe.webhookSecret as string,
    );
  } catch (error) {
    logger.error('Stripe webhook signature verification failed', error);
    return res.status(StatusCodes.BAD_REQUEST).send('Webhook signature verification failed');
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      await OrderService.handlePaymentSucceeded({
        id: paymentIntent.id,
        amountReceived: paymentIntent.amount_received,
        currency: paymentIntent.currency,
        metadata: paymentIntent.metadata,
      });
      break;
    }
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as { id: string };
      await OrderService.handlePaymentFailed(paymentIntent.id);
      break;
    }
    default:
      break;
  }

  res.status(StatusCodes.OK).json({ received: true });
});

const createOnboardingLink = catchAsync(async (req: Request, res: Response) => {
  const result = await ConnectService.onboardingLink((req.user as JwtPayload).id);
  res.status(StatusCodes.OK).json({ success: true, data: result });
});

const connectStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await ConnectService.accountStatus((req.user as JwtPayload).id);
  res.status(StatusCodes.OK).json({ success: true, data: result });
});

const connectReturn = catchAsync(async (req: Request, res: Response) => {
  const result = await ConnectService.statusFromState(String(req.query.state ?? ''));
  res.status(StatusCodes.OK).json({ success: true, data: result });
});

const connectRefresh = catchAsync(async (req: Request, res: Response) => {
  const result = await ConnectService.refreshFromState(String(req.query.state ?? ''));
  res.redirect(result.url);
});

export const PaymentController = {
  stripeWebhook,
  createOnboardingLink,
  connectStatus,
  connectReturn,
  connectRefresh,
};
