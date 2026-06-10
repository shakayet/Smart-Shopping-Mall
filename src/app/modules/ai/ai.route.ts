import express from 'express';
import rateLimit from 'express-rate-limit';
import fileUploadHandler from '../../middlewares/fileUploadHandler';
import { AIController } from './ai.controller';

const router = express.Router();

// Limit AI analysis requests to curb abuse from unauthenticated callers
const analyzeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many analysis requests, please try again later',
  },
});

// Public endpoint - guests can preview AI analysis before creating an account
router.post(
  '/analyze-listing',
  analyzeRateLimiter,
  fileUploadHandler(),
  AIController.analyzeListing,
);

export const AIRoutes = router;
