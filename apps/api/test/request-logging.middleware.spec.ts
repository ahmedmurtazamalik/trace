import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { StructuredLogger } from '../src/common/logging/structured-logger';
import { createRequestCompletionLogger } from '../src/common/middleware/request-logging.middleware';

function requestFixture() {
  return {
    method: 'POST',
    path: '/api/v1/github/callback',
    originalUrl: '/api/v1/github/callback?code=secret-code&state=secret-state',
    headers: { authorization: 'Bearer secret', cookie: 'trace_session=secret' },
    requestId: 'request-123',
  };
}

describe('request completion logging', () => {
  it('emits one bounded structured completion object with no sensitive request material', () => {
    const messages: Array<Record<string, unknown>> = [];
    const sink = { log: (message: Record<string, unknown>) => messages.push(message) };
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = 204;
    let now = 1_000;
    const middleware = createRequestCompletionLogger(sink, () => now);

    middleware(requestFixture() as unknown as Request, response as unknown as Response, (() => undefined) as NextFunction);
    now = 1_037;
    response.emit('finish');
    response.emit('close');

    expect(messages).toEqual([{
      event: 'http.request.completed',
      requestId: 'request-123',
      method: 'POST',
      path: '/api/v1/github/callback',
      statusCode: 204,
      durationMs: 37,
    }]);
    expect(JSON.stringify(messages[0])).not.toContain('secret');
  });

  it('emits one aborted event when the client closes before finish', () => {
    const messages: Array<Record<string, unknown>> = [];
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = 200;
    const middleware = createRequestCompletionLogger({ log: (message) => messages.push(message) }, () => 2_000);

    middleware(requestFixture() as unknown as Request, response as unknown as Response, (() => undefined) as NextFunction);
    response.emit('close');
    response.emit('finish');

    expect(messages).toEqual([expect.objectContaining({
      event: 'http.request.aborted',
      requestId: 'request-123',
    })]);
  });

  it('writes pure JSON with correlation fields and enforces the configured log level', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('warn', (line) => lines.push(line), () => '2026-08-17T00:00:00.000Z');

    logger.log({ event: 'http.request.completed', requestId: 'suppressed' }, 'HttpRequest');
    logger.warn({ event: 'http.request.aborted', requestId: 'request-123' }, 'HttpRequest');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      event: 'http.request.aborted',
      requestId: 'request-123',
      timestamp: '2026-08-17T00:00:00.000Z',
      level: 'warn',
      context: 'HttpRequest',
    });
  });
});
