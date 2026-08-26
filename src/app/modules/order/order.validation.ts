import { z } from 'zod';
import { ORDER_OUTCOME, ORDER_STATUS } from '../../../enums/order';

const checkoutZodSchema = z.object({
  body: z.object({
    deliveryDetails: z.object({
      address: z.string({ required_error: 'Address is required' }),
      location: z.string({ required_error: 'Location is required' }),
      phone: z.string({ required_error: 'Phone number is required' }),
    }),
    note: z.string().trim().max(1000).optional(),
  }),
});

const updateOrderStatusZodSchema = z.object({
  body: z.object({
    status: z.nativeEnum(ORDER_STATUS, {
      required_error: 'Status is required',
    }),
    note: z.string().optional(),
    outcome: z.nativeEnum(ORDER_OUTCOME).optional(),
  }),
});

const reportMissedCollectionZodSchema = z.object({
  body: z.object({
    note: z.string().trim().max(1000).optional(),
  }),
});

const updateOrderScheduleZodSchema = z.object({
  body: z
    .object({
      pickupWindow: z
        .object({
          start: z.string().datetime(),
          end: z.string().datetime(),
        })
        .refine(
          value => new Date(value.end).getTime() > new Date(value.start).getTime(),
          {
            message: 'Pickup window end must be after its start',
            path: ['end'],
          },
        )
        .optional(),
      estimatedDeliveryAt: z.string().datetime().optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .refine(
      value =>
        value.pickupWindow !== undefined ||
        value.estimatedDeliveryAt !== undefined ||
        value.note !== undefined,
      { message: 'Provide a pickup window, estimated delivery, or note' },
    ),
});

export const OrderValidation = {
  checkoutZodSchema,
  updateOrderStatusZodSchema,
  updateOrderScheduleZodSchema,
  reportMissedCollectionZodSchema,
};
