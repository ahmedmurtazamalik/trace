
import loginRequestFixture from './fixtures/auth/login.request.json';
import loginResponseFixture from './fixtures/auth/login.success.json';
import logoutResponseFixture from './fixtures/auth/logout.success.json';
import meResponseFixture from './fixtures/auth/me.success.json';
import passwordForgotRequestFixture from './fixtures/auth/password-forgot.request.json';
import passwordForgotResponseFixture from './fixtures/auth/password-forgot.success.json';
import passwordResetRequestFixture from './fixtures/auth/password-reset.request.json';
import passwordResetResponseFixture from './fixtures/auth/password-reset.success.json';
import registerRequestFixture from './fixtures/auth/register.request.json';
import registerResponseFixture from './fixtures/auth/register.success.json';
import {
  authErrorCodeSchema,
  authSessionResponseSchema,
  csrfHeaderName,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
} from '../src/auth';
import { apiErrorSchema } from '../src/errors';

describe('auth contracts', () => {
  it('accepts the frozen registration request and response fixtures', () => {
    expect(registerRequestSchema.parse(registerRequestFixture)).toEqual(registerRequestFixture);
    expect(authSessionResponseSchema.parse(registerResponseFixture)).toEqual(registerResponseFixture);
  });

  it('accepts the frozen login request and response fixtures', () => {
    expect(loginRequestSchema.parse(loginRequestFixture)).toEqual(loginRequestFixture);
    expect(authSessionResponseSchema.parse(loginResponseFixture)).toEqual(loginResponseFixture);
  });

  it('accepts the frozen current-user and logout response fixtures', () => {
    expect(authSessionResponseSchema.parse(meResponseFixture)).toEqual(meResponseFixture);
    expect(logoutResponseSchema.parse(logoutResponseFixture)).toEqual(logoutResponseFixture);
  });

  it('freezes the CSRF transport header for state-changing authenticated requests', () => {
    expect(csrfHeaderName).toBe('x-csrf-token');
  });

  it('accepts the frozen non-enumerating password-forgot fixtures', () => {
    expect(forgotPasswordRequestSchema.parse(passwordForgotRequestFixture)).toEqual(passwordForgotRequestFixture);
    expect(forgotPasswordResponseSchema.parse(passwordForgotResponseFixture)).toEqual(passwordForgotResponseFixture);
  });

  it('accepts the frozen password-reset fixtures', () => {
    expect(resetPasswordRequestSchema.parse(passwordResetRequestFixture)).toEqual(passwordResetRequestFixture);
    expect(resetPasswordResponseSchema.parse(passwordResetResponseFixture)).toEqual(passwordResetResponseFixture);
  });

  it('rejects invalid usernames and weak passwords', () => {
    expect(registerRequestSchema.safeParse({
      username: '../alice',
      password: 'short',
    }).success).toBe(false);
  });

  it('freezes the endpoint-specific auth error codes', () => {
    const codes = [
      'VALIDATION_ERROR',
      'USERNAME_TAKEN',
      'EMAIL_TAKEN',
      'INVALID_CREDENTIALS',
      'ACCOUNT_DISABLED',
      'UNAUTHENTICATED',
      'CSRF_INVALID',
      'INVALID_OR_EXPIRED_RESET_TOKEN',
      'RATE_LIMITED',
    ];

    expect(codes.map((code) => authErrorCodeSchema.parse(code))).toEqual(codes);
    expect(authErrorCodeSchema.safeParse('GITHUB_LOGIN_REQUIRED').success).toBe(false);
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
