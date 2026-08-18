import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevelopmentPasswordResetDelivery, InMemoryPasswordResetDelivery, UnavailablePasswordResetDelivery } from '../src/modules/auth/password-reset-delivery';

describe('password reset delivery boundary', () => {
  it('accepts delivery only in the test adapter', async () => {
    const delivery = new InMemoryPasswordResetDelivery();

    expect(delivery.available).toBe(true);
    await expect(delivery.deliver({
      email: 'test@example.com',
      token: 'opaque-test-token',
      expiresAt: new Date('2026-08-12T00:00:00.000Z'),
    })).resolves.toBeUndefined();
  });

  it('writes a development-only reset URL to a permission-restricted local outbox', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trace-password-reset-'));
    const delivery = new DevelopmentPasswordResetDelivery(directory, 'http://localhost:3000');

    expect(delivery.available).toBe(true);
    await delivery.deliver({
      email: 'test@example.com',
      token: 'opaque token/with unsafe URL characters',
      expiresAt: new Date('2026-08-12T00:00:00.000Z'),
    });

    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('opaque');
    const path = join(directory, files[0]!);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const message = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
    expect(message).toEqual({
      email: 'test@example.com',
      expiresAt: '2026-08-12T00:00:00.000Z',
      resetUrl: 'http://localhost:3000/reset-password?token=opaque%20token%2Fwith%20unsafe%20URL%20characters',
    });
  });

  it('fails closed when no deployment delivery provider is configured', async () => {
    const delivery = new UnavailablePasswordResetDelivery();

    expect(delivery.available).toBe(false);
    await expect(delivery.deliver({
      email: 'test@example.com',
      token: 'opaque-test-token',
      expiresAt: new Date('2026-08-12T00:00:00.000Z'),
    })).rejects.toThrow('Password reset delivery is not configured');
  });
});
