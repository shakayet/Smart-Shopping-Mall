import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { IssueService } from './issue.service';

const createIssue = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const { productId, issueType, reason } = req.body;

  const result = await IssueService.createIssue(
    productId,
    issueType,
    reason,
    user.id,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Issue created successfully',
    data: result,
  });
});

const resolveIssue = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const { action } = req.body;

  const result = await IssueService.resolveIssue(
    req.params.id,
    action,
    user.id,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Issue resolved successfully',
    data: result,
  });
});

const getIssues = catchAsync(async (req: Request, res: Response) => {
  const result = await IssueService.getIssues();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Issues retrieved successfully',
    data: result,
  });
});

const getIssueById = catchAsync(async (req: Request, res: Response) => {
  const result = await IssueService.getIssueById(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Issue details retrieved successfully',
    data: result,
  });
});

export const IssueController = {
  createIssue,
  resolveIssue,
  getIssues,
  getIssueById,
};
