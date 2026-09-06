/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import fs from 'fs';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { UserService } from './user.service';
import { optimizeUploadedImage } from '../../../helpers/imageOptimizer';
import { uploadToS3 } from '../../../helpers/s3Helper';

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getAllUsersToDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Users retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});

const createUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { ...userData } = req.body;
    const result = await UserService.createUserToDB(userData);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'User created successfully',
      data: result,
    });
  },
);

const getUserProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.getUserProfileFromDB(user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Profile data retrieved successfully',
    data: result,
  });
});

const getProfileStats = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.getProfileStatsFromDB(
    req.params.userId || user.id,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Profile statistics retrieved successfully',
    data: result,
  });
});

//update profile
const updateProfile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as any;
    const fileFields = req.files;
    const imageFiles = fileFields && !Array.isArray(fileFields)
      ? fileFields.image ?? []
      : [];
    let image: string | undefined;
    try {
      if (imageFiles[0]) {
        const optimized = await optimizeUploadedImage(imageFiles[0], 512, 80);
        image = await uploadToS3(optimized, 'profile-images/optimized');
      }
    } finally {
      await Promise.all(
        imageFiles.map(file =>
          fs.promises.unlink(file.path).catch(() => undefined),
        ),
      );
    }

    const data = {
      ...req.body,
      ...(image ? { image, avatar: null } : {}),
    };
    const result = await UserService.updateProfileToDB(user, data);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Profile updated successfully',
      data: result,
    });
  },
);

const deleteProfilePhoto = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;
    const result = await UserService.deleteProfilePhotoFromDB(user);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Profile photo deleted successfully',
      data: result,
    });
  },
);

const deleteAccount = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  await UserService.deleteAccountFromDB(user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User deleted successfully',
  });
});

export const UserController = {
  getAllUsers,
  createUser,
  getUserProfile,
  getProfileStats,
  updateProfile,
  deleteProfilePhoto,
  deleteAccount,
};
