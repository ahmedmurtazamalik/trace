import { Injectable, Logger } from '@nestjs/common';

export interface PasswordResetDelivery {
  deliver(input: { email: string; token: string; expiresAt: Date }): Promise<void>;
}

export const PASSWORD_RESET_DELIVERY = Symbol('PASSWORD_RESET_DELIVERY');

@Injectable()
export class DeferredPasswordResetDelivery implements PasswordResetDelivery {
  private readonly logger = new Logger(DeferredPasswordResetDelivery.name);

  deliver(): Promise<void> {
    this.logger.warn('Password-reset delivery provider is not configured; token was retained only as a hash.');
    return Promise.resolve();
  }
}
