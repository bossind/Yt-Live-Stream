import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors/AppError';

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validateRequest(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        return next(
          new AppError('Invalid route parameters.', 400, 'VALIDATION_ERROR', result.error.issues)
        );
      }
      req.params = result.data as Request['params'];
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        return next(
          new AppError('Invalid query parameters.', 400, 'VALIDATION_ERROR', result.error.issues)
        );
      }
      req.query = result.data as Request['query'];
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        return next(
          new AppError('Invalid request payload.', 400, 'VALIDATION_ERROR', result.error.issues)
        );
      }
      req.body = result.data;
    }

    next();
  };
}
