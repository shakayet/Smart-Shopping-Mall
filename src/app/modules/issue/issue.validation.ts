import { z } from 'zod';
import { ISSUE_TYPE } from '../../../enums/issue';
import { ORDER_OUTCOME } from '../../../enums/order';

const createIssueZodSchema = z.object({
  body: z
    .object({
      productId: z.string({ required_error: 'Product ID is required' }),
      issueType: z.nativeEnum(ISSUE_TYPE, {
        required_error: 'Issue type is required',
      }),
      outcome: z.nativeEnum(ORDER_OUTCOME, {
        required_error: 'Outcome is required',
      }),
      reason: z.string({ required_error: 'Reason is required' }),
    })
    .superRefine((value, context) => {
      const validOutcomes =
        value.issueType === ISSUE_TYPE.VERIFICATION_FAILED
          ? [
              ORDER_OUTCOME.AUTHENTICATION_FAILED,
              ORDER_OUTCOME.COUNTERFEIT,
            ]
          : [
              ORDER_OUTCOME.NOT_AS_DESCRIBED,
              ORDER_OUTCOME.CONDITION_DIFFERS,
              ORDER_OUTCOME.BUYER_CHANGED_MIND,
            ];
      if (!validOutcomes.includes(value.outcome)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outcome'],
          message: `Outcome is not valid for ${value.issueType}`,
        });
      }
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
