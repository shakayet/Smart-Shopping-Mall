import { z } from 'zod';

const createVerifyEmailZodSchema = z.object({
  body: z.object({
    email: z.string({ required_error: 'Email is required' }).email(),
    oneTimeCode: z.number({ required_error: 'One time code is required' }),
  }),
});

const createLoginZodSchema = z.object({
  body: z.object({
    email: z.string({ required_error: 'Email is required' }).email(),
    password: z.string({ required_error: 'Password is required' }),
  }),
});

const createRequestLoginOtpZodSchema = z.object({
  body: z.object({
    email: z.string({ required_error: 'Email is required' }).email(),
  }),
});

const createResendLoginOtpZodSchema = z.object({
  body: z.object({
    email: z.string({ required_error: 'Email is required' }).email(),
  }),
});

const createResendOtpZodSchema = z.object({
  body: z
    .object({
      email: z.string({ required_error: 'Email is required' }).email(),
    })
    .strict(),
});

const createVerifyLoginOtpZodSchema = z.object({
  body: z.object({
    email: z.string({ required_error: 'Email is required' }).email(),
    oneTimeCode: z
      .union([
        z.number({ required_error: 'One time code is required' }),
        z.string({ required_error: 'One time code is required' }),
      ])
      .transform((v) => (typeof v === 'string' ? Number(v) : v))
      .refine((v) => Number.isFinite(v), 'One time code must be a 6-digit number'),
  }),
});

const createForgetPasswordZodSchema = z.object({
  body: z.object({
    email: z.string({ required_error: 'Email is required' }).email(),
  }),
});

const createResetPasswordZodSchema = z.object({
  body: z.object({
    newPassword: z.string({ required_error: 'Password is required' }),
    confirmPassword: z.string({
      required_error: 'Confirm Password is required',
    }),
  }),
});

const createChangePasswordZodSchema = z.object({
  body: z.object({
    currentPassword: z.string({
      required_error: 'Current Password is required',
    }),
    newPassword: z.string({ required_error: 'New Password is required' }),
    confirmPassword: z.string({
      required_error: 'Confirm Password is required',
    }),
  }),
});

const refreshTokenZodSchema = z.object({
  body: z.object({
    refreshToken: z.string({
      required_error: 'Refresh token is required',
    }),
  }),
});

export const AuthValidation = {
  createVerifyEmailZodSchema,
  createForgetPasswordZodSchema,
  createLoginZodSchema,
  createRequestLoginOtpZodSchema,
  createResendLoginOtpZodSchema,
  createResendOtpZodSchema,
  createVerifyLoginOtpZodSchema,
  createResetPasswordZodSchema,
  createChangePasswordZodSchema,
  refreshTokenZodSchema,
};
