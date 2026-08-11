import { describe, expect, it } from 'vitest';
import registerFixture from './fixtures/auth/register.success.json';
import loginFixture from './fixtures/auth/login.success.json';
import {
  authSessionResponseSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
} from '../src/auth';
import { apiErrorSchema } from '../src/errors';

const strongPassword = 'correct-horse-battery-staple';

describe('auth contracts', () => {
  it('accepts the frozen registration fixture', () => {
    expect(registerRequestSchema.parse({
      username: 'alice.dev',
      displayName: 'Alice Developer',
      email: 'alice@example.com',
      password: strongPassword,
    })).toBeDefined();
    expect(authSessionResponseSchema.parse(registerFixture)).toEqual(registerFixture);
  });

  it('accepts the frozen login fixture', () => {
    expect(loginRequestSchema.parse({ username: 'alice.dev', password: strongPassword })).toBeDefined();
    expect(authSessionResponseSchema.parse(loginFixture)).toEqual(loginFixture);
  });

  it('rejects invalid usernames and weak passwords', () => {
    expect(registerRequestSchema.safeParse({
      username: '../alice',
      password: 'short',
    }).success).toBe(false);
  });

  it('defines non-enumerating password reset requests', () => {
    expect(forgotPasswordRequestSchema.parse({ identifier: 'alice@example.com' })).toBeDefined();
    expect(resetPasswordRequestSchema.parse({ token: 'opaque-reset-token', password: strongPassword })).toBeDefined();
  });

  it('accepts the stable API error envelope', () => {
    expect(apiErrorSchema.parse({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      requestId: 'req_01HXYZ',
      fieldErrors: { username: ['Username is already in use.'] },
    })).toBeDefined();
  });
});
