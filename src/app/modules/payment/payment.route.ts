import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import { authLimiter } from '../../middlewares/rateLimiter';
import { PaymentController } from './payment.controller';

const router = express.Router();

router.post(
  '/connect/onboarding',
  authLimiter,
  auth(USER_ROLES.USER),
  PaymentController.createOnboardingLink,
);
router.get(
  '/connect/status',
  auth(USER_ROLES.USER),
  PaymentController.connectStatus,
);
router.get('/connect/return', PaymentController.connectReturn);
router.get('/connect/refresh', PaymentController.connectRefresh);

export const PaymentRoutes = router;
