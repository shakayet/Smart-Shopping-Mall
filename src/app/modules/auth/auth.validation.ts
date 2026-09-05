import { z } from 'zod';

const otpValidationMessage = 'One time code must be a 5-digit number';
const fiveDigitOtpNumber = z
  .number({
    required_error: 'One time code is required',
    invalid_type_error: otpValidationMessage,
  })
  .int(otpValidationMessage)
  .min(10000, otpValidationMessage)
  .max(99999, otpValidationMessage);

const createVerifyEmailZodSchema = z.object({
  body: z.object({
    email: z.string({ required_error: 'Email is required' }).email(),
    oneTimeCode: fiveDigitOtpNumber,
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
        z
          .string({ required_error: 'One time code is required' })
          .regex(/^\d{5}$/, otpValidationMessage),
      ])
      .transform((v) => (typeof v === 'string' ? Number(v) : v))
      .refine(
        (v) => Number.isInteger(v) && v >= 10000 && v <= 99999,
        otpValidationMessage,
      ),
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
