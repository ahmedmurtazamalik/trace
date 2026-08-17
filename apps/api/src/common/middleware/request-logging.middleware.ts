import { Logger } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RequestWithId } from './request-id.middleware';

export interface RequestLogSink {
  log(message: Record<string, unknown>): unknown;
}

export function createRequestCompletionLogger(
  sink: RequestLogSink = new Logger('HttpRequest'),
  now: () => number = Date.now,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = now();
    let finalized = false;
    const finalize = (outcome: 'completed' | 'aborted'): void => {
      if (finalized) return;
      finalized = true;
      const requestWithId = request as RequestWithId;
      sink.log({
        event: `http.request.${outcome}`,
        requestId: requestWithId.requestId ?? 'unknown',
        method: request.method.slice(0, 16),
        path: request.path.slice(0, 2_048),
        statusCode: response.statusCode,
        durationMs: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, now() - startedAt)),
      });
    };
    response.once('finish', () => finalize('completed'));
    response.once('close', () => finalize('aborted'));
    next();
  };
}
