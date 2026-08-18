import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';

export interface PasswordResetDeliveryInput {
  email: string;
  token: string;
  expiresAt: Date;
}

export interface PasswordResetDelivery {
  readonly available: boolean;
  deliver(input: PasswordResetDeliveryInput): Promise<void>;
}

export const PASSWORD_RESET_DELIVERY = Symbol('PASSWORD_RESET_DELIVERY');

@Injectable()
export class InMemoryPasswordResetDelivery implements PasswordResetDelivery {
  readonly available = true;

  deliver(input: PasswordResetDeliveryInput): Promise<void> {
    void input;
    return Promise.resolve();
  }
}

@Injectable()
export class DevelopmentPasswordResetDelivery implements PasswordResetDelivery {
  readonly available = true;

  constructor(
    private readonly directory: string,
    private readonly frontendOrigin: string,
  ) {}

  async deliver(input: PasswordResetDeliveryInput): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const resetUrl = `${new URL('/reset-password', this.frontendOrigin).toString()}?token=${encodeURIComponent(input.token)}`;
    const path = join(this.directory, `password-reset-${Date.now()}-${randomUUID()}.json`);
    await writeFile(path, `${JSON.stringify({
      email: input.email,
      expiresAt: input.expiresAt.toISOString(),
      resetUrl,
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
}

@Injectable()
export class UnavailablePasswordResetDelivery implements PasswordResetDelivery {
  readonly available = false;

  deliver(input: PasswordResetDeliveryInput): Promise<void> {
    void input;
    return Promise.reject(new Error('Password reset delivery is not configured'));
  }
}
