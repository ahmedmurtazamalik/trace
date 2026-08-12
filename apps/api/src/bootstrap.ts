import { RequestMethod, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { TRACE_CONFIG } from './common/config/config.token';
import type { TraceConfig } from '@trace/config';

export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get<TraceConfig>(TRACE_CONFIG);

  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
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
