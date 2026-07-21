import { z } from 'zod';
import { ISSUE_TYPE } from '../../../enums/issue';

const createIssueZodSchema = z.object({
  body: z.object({
    productId: z.string({ required_error: 'Product ID is required' }),
    issueType: z.nativeEnum(ISSUE_TYPE, { required_error: 'Issue type is required' }),
    reason: z.string({ required_error: 'Reason is required' }),
  }),
});

const resolveIssueZodSchema = z.object({
  body: z.object({
    action: z.enum(['delete', 'make_available'], { required_error: 'Action is required' }),
  }),
});

export const IssueValidation = {
  createIssueZodSchema,
  resolveIssueZodSchema,
};
