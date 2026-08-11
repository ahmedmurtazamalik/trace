import { Injectable } from '@nestjs/common';

export interface PasswordResetDelivery {
  deliver(input: { email: string; token: string; expiresAt: Date }): Promise<void>;
}

export const PASSWORD_RESET_DELIVERY = Symbol('PASSWORD_RESET_DELIVERY');

@Injectable()
export class DeferredPasswordResetDelivery implements PasswordResetDelivery {
  deliver(): Promise<void> {
    // Deliberately silent so logs cannot distinguish known and unknown identifiers.
    return Promise.resolve();
  }
}
