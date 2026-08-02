import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

const extractEmailForRateLimitKey = (req: Request): string => {
  const body = req.body as Record<string, unknown> | undefined | null;
  const email = body?.email;
  return typeof email === 'string' ? email.toLowerCase() : '';
};

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts, please try again later.',
  },
});

export const otpGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 15, // Max 15 OTP generation / email-request calls per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = extractEmailForRateLimitKey(req);
    return `${ipKeyGenerator(req.ip ?? 'unknown')}:${email}`;
  },
  message: {
    success: false,
    message:
      'Too many OTP requests from this address. Please try again in an hour.',
  },
});

export const otpVerificationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 8, // Max 8 verification attempts per IP per 10 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = extractEmailForRateLimitKey(req);
    return `${ipKeyGenerator(req.ip ?? 'unknown')}:${email}`;
  },
  message: {
    success: false,
    message:
      'Too many verification attempts. Please request a new OTP and try again.',
  },
});
