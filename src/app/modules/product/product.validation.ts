import { z } from 'zod';

const createProductZodSchema = z.object({
    name: z.string({ required_error: 'Name is required' }),
    brand: z.string({ required_error: 'Brand is required' }),
    description: z.string({ required_error: 'Description is required' }),
    price: z.number({ required_error: 'Price is required' }),
    condition: z.string({ required_error: 'Condition is required' }),
});

const updateProductZodSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    brand: z.string().optional(),
    description: z.string().optional(),
    price: z.number().optional(),
    condition: z.string().optional(),
    status: z.enum(['available', 'secured', 'sold']).optional(),
  }),
});

export const ProductValidation = {
  createProductZodSchema,
  updateProductZodSchema,
};
