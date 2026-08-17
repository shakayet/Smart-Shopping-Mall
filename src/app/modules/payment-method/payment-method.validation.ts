import { z } from 'zod';
import { isValidPaymentMethodId } from './payment-method.util';

const listPaymentMethodsZodSchema = z.object({
  query: z
    .object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      startingAfter: z.string().refine(isValidPaymentMethodId).optional(),
    })
    .strict(),
});

const createSetupIntentZodSchema = z.object({
  body: z.object({}).strict().optional(),
});

const deletePaymentMethodZodSchema = z.object({
  params: z.object({
    id: z.string().refine(isValidPaymentMethodId, {
      message: 'Invalid payment method ID',
    }),
  }),
});

export const PaymentMethodValidation = {
  listPaymentMethodsZodSchema,
  createSetupIntentZodSchema,
  deletePaymentMethodZodSchema,
};
