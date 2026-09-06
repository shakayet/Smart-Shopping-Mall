import express, { NextFunction, Request, Response } from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploadHandler';
import validateRequest from '../../middlewares/validateRequest';
import { UserController } from './user.controller';
import { UserValidation } from './user.validation';
const router = express.Router();

router.get(
  '/profile/stats',
  auth(USER_ROLES.USER),
  UserController.getProfileStats,
);
router.get(
  '/profile/stats/:userId',
  auth(USER_ROLES.USER),
  validateRequest(UserValidation.profileStatsParamsZodSchema),
  UserController.getProfileStats,
);

router.delete(
  '/profile/photo',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.USER),
  UserController.deleteProfilePhoto,
);

router
  .route('/profile')
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.USER),
    UserController.getUserProfile,
  )
  .patch(
    auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.USER),
    fileUploadHandler(),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const profileData = req.body.data
          ? JSON.parse(req.body.data)
          : req.body;
        req.body = UserValidation.updateUserZodSchema.parse(profileData);
        return UserController.updateProfile(req, res, next);
      } catch (error) {
        next(error);
      }
    },
  )
  .delete(
    auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.USER),
    UserController.deleteAccount,
  );

router
  .route('/')
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    UserController.getAllUsers,
  );

export const UserRoutes = router;
