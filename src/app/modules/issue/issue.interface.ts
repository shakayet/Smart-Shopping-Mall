import { Types } from 'mongoose';
import { ISSUE_TYPE } from '../../../enums/issue';

export type IIssue = {
  product: Types.ObjectId;
  buyer?: Types.ObjectId;
  seller: Types.ObjectId;
  issueType: ISSUE_TYPE;
  reason: string;
  admin: Types.ObjectId;
  resolved: boolean;
}
