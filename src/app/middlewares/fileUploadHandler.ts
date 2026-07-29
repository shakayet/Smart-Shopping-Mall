/* eslint-disable no-undef */
import { NextFunction, Request, RequestHandler, Response } from 'express';
import fs from 'fs';
import { StatusCodes } from 'http-status-codes';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import crypto from 'crypto';
import ApiError from '../../errors/ApiError';
import config from '../../config';

const fileUploadHandler = () => {
  //create upload folder
  const baseUploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(baseUploadDir)) {
    fs.mkdirSync(baseUploadDir, { recursive: true });
  }

  //folder create for different file
  const createDir = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  };

  //create filename
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      let uploadDir;
      switch (file.fieldname) {
        case 'image':
          uploadDir = path.join(baseUploadDir, 'image');
          break;
        case 'media':
          uploadDir = path.join(baseUploadDir, 'media');
          break;
        case 'doc':
          uploadDir = path.join(baseUploadDir, 'doc');
          break;
        default:
          throw new ApiError(StatusCodes.BAD_REQUEST, 'File is not supported');
      }
      createDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const fileExt = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${fileExt}`);
    },
  });

  //file filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterFilter = (req: Request, file: any, cb: FileFilterCallback) => {
    if (file.fieldname === 'image') {
      if (
        file.mimetype === 'image/jpeg' ||
        file.mimetype === 'image/png' ||
        file.mimetype === 'image/jpg'
      ) {
        cb(null, true);
      } else {
        cb(
          new ApiError(
            StatusCodes.BAD_REQUEST,
            'Only .jpeg, .png, .jpg file supported',
          ),
        );
      }
    } else if (file.fieldname === 'media') {
      if (file.mimetype === 'video/mp4' || file.mimetype === 'audio/mpeg') {
        cb(null, true);
      } else {
        cb(
          new ApiError(
            StatusCodes.BAD_REQUEST,
            'Only .mp4, .mp3, file supported',
          ),
        );
      }
    } else if (file.fieldname === 'doc') {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new ApiError(StatusCodes.BAD_REQUEST, 'Only pdf supported'));
      }
    } else {
      cb(new ApiError(StatusCodes.BAD_REQUEST, 'This file is not supported'));
    }
  };

  const upload = multer({
    storage: storage,
    fileFilter: filterFilter,
    limits: {
      fileSize: config.uploads.maxBytes,
      files: 6,
      fields: 25,
      parts: 31,
    },
  }).fields([
    { name: 'image', maxCount: 3 },
    { name: 'media', maxCount: 3 },
    { name: 'doc', maxCount: 3 },
  ]);

  const hasExpectedSignature = (file: Express.Multer.File) => {
    const bytes = Buffer.alloc(12);
    const descriptor = fs.openSync(file.path, 'r');
    try {
      const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
      const header = bytes.subarray(0, length);
      if (file.mimetype === 'image/png') {
        return header.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
      }
      if (['image/jpeg', 'image/jpg'].includes(file.mimetype)) {
        return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
      }
      if (file.mimetype === 'application/pdf') {
        return header.subarray(0, 5).toString() === '%PDF-';
      }
      if (file.mimetype === 'audio/mpeg') {
        return (
          header.subarray(0, 3).toString() === 'ID3' ||
          (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
        );
      }
      if (file.mimetype === 'video/mp4') {
        return header.subarray(4, 8).toString() === 'ftyp';
      }
      return false;
    } finally {
      fs.closeSync(descriptor);
    }
  };

  const removeFiles = (files: Express.Multer.File[]) => {
    for (const file of files) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // Cleanup is best-effort; the original validation error is more useful.
      }
    }
  };

  const handler: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    upload(req, res, error => {
      if (error) {
        next(error);
        return;
      }
      const fields = req.files;
      const files =
        fields && !Array.isArray(fields) ? Object.values(fields).flat() : [];
      if (!files.every(hasExpectedSignature)) {
        removeFiles(files);
        next(new ApiError(StatusCodes.BAD_REQUEST, 'Invalid file content'));
        return;
      }
      next();
    });
  };
  return handler;
};

export default fileUploadHandler;
