import { z } from 'zod';

const createUserZodSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    email: z.string({ required_error: 'Email is required' }).email('Invalid email'),
    contact: z.string().trim().max(32).optional(),
    phone: z.string().trim().max(32).optional(),
    location: z.string().trim().max(150).optional(),
    country: z.string().trim().max(100).optional(),
    profile: z.string().optional(),
  }),
});

const updateUserZodSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  image: z.string().optional(),
  contact: z.string().trim().max(32).optional(),
  phone: z.string().trim().max(32).optional(),
  location: z.string().trim().max(150).optional(),
  country: z.string().trim().max(100).optional(),
});

const profileStatsParamsZodSchema = z.object({
  params: z.object({
    userId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user ID'),
  }),
});

export const UserValidation = {
  createUserZodSchema,
  updateUserZodSchema,
  profileStatsParamsZodSchema,
};
