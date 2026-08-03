import { z } from 'zod';

const createUserZodSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    email: z.string({ required_error: 'Email is required' }).email('Invalid email'),
    contact: z.string().optional(),
    location: z.string().optional(),
    country: z.string().optional(),
    profile: z.string().optional(),
  }),
});

const updateUserZodSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  image: z.string().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
});

export const UserValidation = {
  createUserZodSchema,
  updateUserZodSchema,
};
