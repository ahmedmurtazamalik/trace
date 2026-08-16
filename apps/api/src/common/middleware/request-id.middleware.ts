import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}

const safeRequestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function establishRequestId(request: RequestWithId, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  request.requestId = incoming !== undefined && safeRequestId.test(incoming) ? incoming : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
