import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiResponse } from '../../shared/types/api';
import { env } from '../config/env';
import { AppError } from '../errors/AppError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`API route not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND'));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected server error occurred.';
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = env.isProduction ? undefined : err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed.';
    details = env.isProduction ? undefined : err.issues;
  } else if (err instanceof SyntaxError && 'status' in err) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON request body.';
  } else if (err instanceof Error) {
    if (!env.isProduction) {
      message = err.message;
    }
  }

  if (statusCode >= 500) {
    console.error('[API Error]', err);
  }

  const payload: ApiResponse<never> = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(payload);
}
