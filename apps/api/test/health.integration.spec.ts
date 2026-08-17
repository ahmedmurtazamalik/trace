import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApplication } from '../src/bootstrap';
import { applyIntegrationEnvironment } from './support/integration-environment';

describe('API health endpoints', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    applyIntegrationEnvironment();
    app = await createApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports process liveness outside the API prefix', async () => {
    const response = await request(server).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'trace-api' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports PostgreSQL and Redis readiness', async () => {
    const response = await request(server).get('/ready').expect(200);

    expect(response.body).toEqual({
      status: 'ready',
      dependencies: { postgres: 'up', redis: 'up' },
    });
  });

  it('returns the centralized safe error envelope', async () => {
    const response = await request(server).get('/api/v1/does-not-exist').expect(404);

    expect(response.body).toEqual({
      code: 'NOT_FOUND',
      message: 'Cannot GET /api/v1/does-not-exist',
      requestId: response.headers['x-request-id'],
    });
  });
});
