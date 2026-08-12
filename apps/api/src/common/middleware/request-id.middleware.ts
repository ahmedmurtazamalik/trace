import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}

export function establishRequestId(request: RequestWithId, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  request.requestId = incoming !== undefined && incoming.length <= 128 ? incoming : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
