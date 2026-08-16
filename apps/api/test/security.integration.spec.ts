import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from '../src/bootstrap';

describe('API transport security', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    process.env.FRONTEND_ORIGIN = 'https://frontend.example.test';
    for (const name of [
      'GITHUB_APP_PRIVATE_KEY',
      'LLM_API_KEY',
      'STORAGE_BUCKET',
      'STORAGE_ENDPOINT',
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
    ]) delete process.env[name];
    app = await createApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets browser hardening headers on public and API responses', async () => {
    for (const path of ['/health', '/api/v1/auth/me']) {
      const response = await request(server).get(path);
      expect(response.headers).toMatchObject({
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'origin-agent-cluster': '?1',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-dns-prefetch-control': 'off',
        'x-download-options': 'noopen',
        'x-frame-options': 'SAMEORIGIN',
        'x-permitted-cross-domain-policies': 'none',
        'x-xss-protection': '0',
      });
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['strict-transport-security']).toContain('max-age=');
      expect(response.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('replaces unsafe caller-provided request IDs before echoing or logging them', async () => {
    const response = await request(server).get('/health').set('X-Request-Id', 'attacker\tid').expect(200);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows credentials only for the configured frontend origin', async () => {
    const allowed = await request(server).get('/health').set('Origin', 'https://frontend.example.test').expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://frontend.example.test');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers.vary).toContain('Origin');

    const foreign = await request(server).get('/health').set('Origin', 'https://foreign.example.test').expect(200);
    expect(foreign.headers['access-control-allow-origin']).not.toBe('https://foreign.example.test');
  });
});
