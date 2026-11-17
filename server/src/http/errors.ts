import { TestValidationError, type ApiErrorBody } from '@ielts/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly issues?: Array<{ path: string; message: string }>) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let body: ApiErrorBody = { error: 'server_error', message: 'Something went wrong on the server.' };
  if (err instanceof HttpError) {
    status = err.status;
    body = { error: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) };
  } else if (err instanceof TestValidationError) {
    status = 400;
    body = { error: 'invalid_test', message: err.message, issues: err.errors };
  } else if (err instanceof ZodError) {
    status = 400;
    body = { error: 'invalid_request', message: 'The request is not valid.', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) };
  } else if ((err as { type?: string })?.type === 'entity.too.large') {
    status = 413;
    body = { error: 'too_large', message: 'The request is too large.' };
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: 'bad_json', message: 'The request body is not valid JSON.' };
  }
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return;
  res.status(status).json(body);
}
