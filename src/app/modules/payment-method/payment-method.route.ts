import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import { paymentMethodMutationLimiter } from '../../middlewares/rateLimiter';
import validateRequest from '../../middlewares/validateRequest';
import { PaymentMethodController } from './payment-method.controller';
import { PaymentMethodValidation } from './payment-method.validation';

const router = express.Router();

router.get(
  '/',
  auth(USER_ROLES.USER),
  validateRequest(PaymentMethodValidation.listPaymentMethodsZodSchema),
  PaymentMethodController.getPaymentMethods,
);

router.post(
  '/setup-intent',
  auth(USER_ROLES.USER),
  paymentMethodMutationLimiter,
  validateRequest(PaymentMethodValidation.createSetupIntentZodSchema),
  PaymentMethodController.createSetupIntent,
);

router.delete(
  '/:id',
  auth(USER_ROLES.USER),
  paymentMethodMutationLimiter,
  validateRequest(PaymentMethodValidation.deletePaymentMethodZodSchema),
  PaymentMethodController.deletePaymentMethod,
);

export const PaymentMethodRoutes = router;
