import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import config from '../../../config';
import catchAsync from '../../../shared/catchAsync';
import { stripeClient } from '../../../integrations/stripe';
import { logger } from '../../../shared/logger';
import { OrderService } from '../order/order.service';

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
      const paymentIntent = event.data.object as { id: string };
      await OrderService.handlePaymentSucceeded(paymentIntent.id);
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

export const PaymentController = {
  stripeWebhook,
};
