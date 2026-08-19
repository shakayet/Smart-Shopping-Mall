import { ErrorRequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import config from '../../config';
import ApiError from '../../errors/ApiError';
import handleValidationError from '../../errors/handleValidationError';
import handleZodError from '../../errors/handleZodError';
import { errorLogger } from '../../shared/logger';
import { IErrorMessage } from '../../types/errors.types';

const globalErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  void _next;
  const errorName =
    typeof error?.name === 'string' ? error.name : 'UnknownError';
  const errorMessage =
    typeof error?.message === 'string' ? error.message : 'Unknown error';
  errorLogger.error(
    `[GLOBAL_ERROR] ${req.method} ${req.originalUrl} ${errorName}: ${errorMessage}`,
  );

  let statusCode = 500;
  let message = 'Something went wrong';
  let errorMessages: IErrorMessage[] = [];

  if (error.name === 'ZodError') {
    const simplifiedError = handleZodError(error);
    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
    errorMessages = simplifiedError.errorMessages;
  } else if (error.name === 'ValidationError') {
    const simplifiedError = handleValidationError(error);
    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
    errorMessages = simplifiedError.errorMessages;
  } else if (error.name === 'TokenExpiredError') {
    statusCode = StatusCodes.UNAUTHORIZED;
    message = 'Session Expired';
    errorMessages = error?.message
      ? [
          {
            path: '',
            message:
              'Your session has expired. Please log in again to continue.',
          },
        ]
      : [];
  } else if (error instanceof ApiError) {
    statusCode = error.statusCode;
    message = error.message;
    errorMessages = error.message
      ? [
          {
            path: '',
            message: error.message,
          },
        ]
      : [];
  } else if (error instanceof Error) {
    message =
      config.node_env === 'production'
        ? 'Something went wrong'
        : error.message;
    errorMessages = error.message
      ? [
          {
            path: '',
            message: error?.message,
          },
        ]
      : [];
  }

  res.status(statusCode).json({
    success: false,
    message,
    errorMessages,
    stack: config.node_env !== 'production' ? error?.stack : undefined,
  });
};

export default globalErrorHandler;
