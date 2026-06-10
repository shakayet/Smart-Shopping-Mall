import { z } from 'zod';
import { ORDER_STATUS } from '../../../enums/order';

const checkoutZodSchema = z.object({
  body: z.object({
    deliveryDetails: z.object({
      address: z.string({ required_error: 'Address is required' }),
      location: z.string({ required_error: 'Location is required' }),
      phone: z.string({ required_error: 'Phone number is required' }),
    }),
  }),
});

const updateOrderStatusZodSchema = z.object({
  body: z.object({
    status: z.nativeEnum(ORDER_STATUS, {
      required_error: 'Status is required',
    }),
    note: z.string().optional(),
  }),
});

export const OrderValidation = {
  checkoutZodSchema,
  updateOrderStatusZodSchema,
};
