import callbackErrorFixture from './fixtures/github/callback.error.json';
import callbackSuccessFixture from './fixtures/github/callback.success.json';
import connectFixture from './fixtures/github/connect.success.json';
import disconnectFixture from './fixtures/github/disconnect.success.json';
import connectedFixture from './fixtures/github/status.connected.json';
import disconnectedFixture from './fixtures/github/status.disconnected.json';
import reconnectRequiredFixture from './fixtures/github/status.reconnect-required.json';
import {
  githubCallbackQuerySchema,
  githubCallbackResultSchema,
  githubConnectResponseSchema,
  githubConnectionStatusSchema,
  githubDisconnectResponseSchema,
  githubErrorCodeSchema,
} from '../src/github';

describe('Day 3 GitHub connection contract', () => {
  it('accepts only a backend-provided GitHub authorization URL', () => {
    expect(githubConnectResponseSchema.parse(connectFixture)).toEqual(connectFixture);
    expect(githubConnectResponseSchema.safeParse({ authorizationUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('freezes validated callback input and safe frontend callback results', () => {
    expect(githubCallbackQuerySchema.parse({ code: 'opaque-code', state: 'opaque-state-at-least-thirty-two-characters' })).toEqual({
      code: 'opaque-code',
      state: 'opaque-state-at-least-thirty-two-characters',
    });
    expect(githubCallbackResultSchema.parse(callbackSuccessFixture)).toEqual(callbackSuccessFixture);
    expect(githubCallbackResultSchema.parse(callbackErrorFixture)).toEqual(callbackErrorFixture);
    expect(githubCallbackResultSchema.safeParse({ result: 'error', reason: 'raw OAuth provider error' }).success).toBe(false);
  });

  it('keeps Trace account connection separate from installation authorization', () => {
    expect(githubConnectionStatusSchema.parse(connectedFixture)).toEqual(connectedFixture);
    expect(githubConnectionStatusSchema.parse(disconnectedFixture)).toEqual(disconnectedFixture);
    expect(githubConnectionStatusSchema.parse(reconnectRequiredFixture)).toEqual(reconnectRequiredFixture);
  });

  it('freezes disconnect history retention and closed error codes', () => {
    expect(githubDisconnectResponseSchema.parse(disconnectFixture)).toEqual(disconnectFixture);
    const codes = [
      'GITHUB_STATE_INVALID',
      'GITHUB_CALLBACK_FAILED',
      'GITHUB_NOT_CONNECTED',
      'GITHUB_RECONNECT_REQUIRED',
      'GITHUB_INSTALLATION_REQUIRED',
      'GITHUB_INSTALLATION_SUSPENDED',
    ];
    expect(codes.map((code) => githubErrorCodeSchema.parse(code))).toEqual(codes);
    expect(githubErrorCodeSchema.safeParse('RAW_PROVIDER_ERROR').success).toBe(false);
  });
});
