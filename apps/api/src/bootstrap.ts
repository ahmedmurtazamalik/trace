import { RequestMethod, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, raw, type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { TRACE_CONFIG } from './common/config/config.token';
import type { TraceConfig } from '@trace/config';
import { establishRequestId, type RequestWithId } from './common/middleware/request-id.middleware';

export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get<TraceConfig>(TRACE_CONFIG);

  app.use(helmet());
  app.use(establishRequestId);
  app.use('/api/v1/webhooks/github', raw({ type: 'application/json', limit: '256kb' }));
  const payloadLimitHandler: ErrorRequestHandler = (error, request, response, next) => {
    const unknownError: unknown = error;
    if (
      typeof unknownError === 'object'
      && unknownError !== null
      && 'type' in unknownError
      && unknownError.type === 'entity.too.large'
    ) {
      const isGithubWebhook = request.originalUrl.split('?')[0] === '/api/v1/webhooks/github';
      response.status(413).json({
        code: isGithubWebhook ? 'WEBHOOK_PAYLOAD_TOO_LARGE' : 'PAYLOAD_TOO_LARGE',
        message: isGithubWebhook ? 'Webhook payload is too large.' : 'Request payload is too large.',
        requestId: (request as RequestWithId).requestId ?? 'unknown',
      });
      return;
    }
    next(error);
  };
  app.use(json({ limit: '1mb' }));
  app.use(payloadLimitHandler);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.enableCors({
    origin: config.frontendOrigin,
    credentials: true,
  });
  app.enableShutdownHooks();
  return app;
}
