import { InMemoryPasswordResetDelivery, UnavailablePasswordResetDelivery } from '../src/modules/auth/password-reset-delivery';

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
