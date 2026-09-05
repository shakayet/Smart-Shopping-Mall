import fs from 'fs';
import path from 'path';
import { StatusCodes } from 'http-status-codes';
import { Jimp, JimpMime } from 'jimp';
import type { Express } from 'express';
import ApiError from '../errors/ApiError';

const MAX_IMAGE_PIXELS = 40_000_000;

export type OptimizedImage = {
  buffer: Buffer;
  mimetype: 'image/jpeg' | 'image/png';
  extension: '.jpg' | '.png';
  width: number;
  height: number;
  optimized: boolean;
};

export const optimizeImageBuffer = async (
  input: Buffer,
  sourceMime: string,
  maxDimension: number,
  quality = 82,
): Promise<OptimizedImage> => {
  const image = await Jimp.read(input);
  const sourceWidth = image.bitmap.width;
  const sourceHeight = image.bitmap.height;

  if (sourceWidth * sourceHeight > MAX_IMAGE_PIXELS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Image dimensions are too large',
    );
  }

  const resized = sourceWidth > maxDimension || sourceHeight > maxDimension;
  if (resized) {
    image.scaleToFit({ w: maxDimension, h: maxDimension });
  }

  // Flatten transparent PNGs onto white so converting product photography to
  // JPEG never creates a black background.
  const flattened = new Jimp({
    width: image.bitmap.width,
    height: image.bitmap.height,
    color: 0xffffffff,
  });
  flattened.composite(image, 0, 0);
  const jpeg = await flattened.getBuffer(JimpMime.jpeg, { quality });

  const normalizedSourceMime = sourceMime === JimpMime.png
    ? JimpMime.png
    : JimpMime.jpeg;
  if (!resized && jpeg.length >= input.length) {
    return {
      buffer: input,
      mimetype: normalizedSourceMime,
      extension: normalizedSourceMime === JimpMime.png ? '.png' : '.jpg',
      width: sourceWidth,
      height: sourceHeight,
      optimized: false,
    };
  }

  return {
    buffer: jpeg,
    mimetype: JimpMime.jpeg,
    extension: '.jpg',
    width: image.bitmap.width,
    height: image.bitmap.height,
    optimized: true,
  };
};

export const optimizeUploadedImage = async (
  file: Express.Multer.File,
  maxDimension = 1_600,
  quality = 82,
): Promise<Express.Multer.File> => {
  try {
    const input = await fs.promises.readFile(file.path);
    const optimized = await optimizeImageBuffer(
      input,
      file.mimetype,
      maxDimension,
      quality,
    );
    const baseName = path.parse(file.originalname).name;

    return {
      ...file,
      buffer: optimized.buffer,
      mimetype: optimized.mimetype,
      originalname: `${baseName}${optimized.extension}`,
      size: optimized.buffer.length,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Unable to process image');
  }
};

export const optimizeLocalUploadedImage = async (
  file: Express.Multer.File,
  maxDimension = 512,
  quality = 80,
): Promise<void> => {
  try {
    const input = await fs.promises.readFile(file.path);
    const optimized = await optimizeImageBuffer(
      input,
      file.mimetype,
      maxDimension,
      quality,
    );
    if (!optimized.optimized) return;

    const parsedPath = path.parse(file.path);
    const originalName = `${path.parse(file.originalname).name}${optimized.extension}`;
    const optimizedFilename = `${parsedPath.name}${optimized.extension}`;
    const optimizedPath = path.join(parsedPath.dir, optimizedFilename);
    await fs.promises.writeFile(optimizedPath, optimized.buffer);
    if (optimizedPath !== file.path) {
      await fs.promises.unlink(file.path).catch(() => undefined);
    }

    file.filename = optimizedFilename;
    file.path = optimizedPath;
    file.mimetype = optimized.mimetype;
    file.originalname = originalName;
    file.size = optimized.buffer.length;
  } catch (error) {
    await fs.promises.unlink(file.path).catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Unable to process image');
  }
};
