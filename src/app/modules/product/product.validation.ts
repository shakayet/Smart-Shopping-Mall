import { z } from 'zod';

const createProductZodSchema = z.object({
    name: z.string({ required_error: 'Name is required' }),
    brand: z.string({ required_error: 'Brand is required' }),
    description: z.string({ required_error: 'Description is required' }),
    material: z.string().trim().max(100).optional(),
    features: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    price: z.number({ required_error: 'Price is required' }),
    condition: z.string({ required_error: 'Condition is required' }),
    originalPackagingAvailable: z.boolean({
      required_error: 'Original packaging availability is required',
    }),
});

const updateProductZodSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    brand: z.string().optional(),
    description: z.string().optional(),
    material: z.string().trim().max(100).optional(),
    features: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    price: z.number().optional(),
    condition: z.string().optional(),
    originalPackagingAvailable: z.boolean().optional(),
    proofOfPurchase: z.string().url().nullable().optional(),
    status: z.enum(['available', 'secured', 'sold']).optional(),
  }),
});

export const ProductValidation = {
  createProductZodSchema,
  updateProductZodSchema,
};
