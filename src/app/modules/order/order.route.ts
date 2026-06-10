import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { OrderController } from './order.controller';
import { OrderValidation } from './order.validation';

const router = express.Router();

// Admin endpoints
router.get(
  '/admin/all',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  OrderController.getAllOrdersForAdmin,
);

router.patch(
  '/:id/status',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(OrderValidation.updateOrderStatusZodSchema),
  OrderController.updateOrderStatus,
);

router.patch(
  '/:id/payout',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  OrderController.markPayoutPaid,
);

// Buyer/seller endpoints
router.post(
  '/:productId/checkout',
  auth(USER_ROLES.USER),
  validateRequest(OrderValidation.checkoutZodSchema),
  OrderController.checkoutOrder,
);

router.post('/:id/cancel', auth(USER_ROLES.USER), OrderController.cancelOrder);

router.get(
  '/',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  OrderController.getMyOrders,
);

router.get(
  '/:id',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  OrderController.getOrderDetails,
);

export const OrderRoutes = router;
