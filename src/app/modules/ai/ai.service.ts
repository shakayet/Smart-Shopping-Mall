/* eslint-disable no-undef */
import fs from 'fs';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { uploadToS3 } from '../../../helpers/s3Helper';
import { analyzeProductImage } from '../../../integrations/openai';

const analyzeListingImage = async (file: Express.Multer.File | undefined) => {
  if (!file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Product image is required');
  }

  let imageUrl: string;
  try {
    imageUrl = await uploadToS3(file, 'listing-analysis');
  } finally {
    await fs.promises.unlink(file.path).catch(() => undefined);
  }

  const analysis = await analyzeProductImage(imageUrl);

  return { imageUrl, ...analysis };
};

export const AIService = {
  analyzeListingImage,
};
