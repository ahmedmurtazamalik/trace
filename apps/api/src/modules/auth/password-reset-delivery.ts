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
export class UnavailablePasswordResetDelivery implements PasswordResetDelivery {
  readonly available = false;

  deliver(input: PasswordResetDeliveryInput): Promise<void> {
    void input;
    return Promise.reject(new Error('Password reset delivery is not configured'));
  }
}
