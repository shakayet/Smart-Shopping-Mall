/* eslint-disable @typescript-eslint/no-explicit-any, no-undef */
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AIService } from './ai.service';

const analyzeListing = catchAsync(async (req: Request, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const image = files?.image?.[0];

  const result = await AIService.analyzeListingImage(image);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Listing analyzed successfully',
    data: result,
  });
});

export const AIController = {
  analyzeListing,
};
