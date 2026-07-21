import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { IssueController } from './issue.controller';
import { IssueValidation } from './issue.validation';

const router = express.Router();

// Admin-only routes
router.post(
  '/',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(IssueValidation.createIssueZodSchema),
  IssueController.createIssue,
);

router.patch(
  '/:id/resolve',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(IssueValidation.resolveIssueZodSchema),
  IssueController.resolveIssue,
);

router.get(
  '/',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  IssueController.getIssues,
);

router.get(
  '/:id',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  IssueController.getIssueById,
);

export const IssueRoutes = router;
