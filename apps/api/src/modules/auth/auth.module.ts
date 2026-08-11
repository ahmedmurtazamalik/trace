import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { DeferredPasswordResetDelivery, PASSWORD_RESET_DELIVERY } from './password-reset-delivery';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitService,
    SessionAuthGuard,
    CsrfGuard,
    DeferredPasswordResetDelivery,
    { provide: PASSWORD_RESET_DELIVERY, useExisting: DeferredPasswordResetDelivery },
  ],
  exports: [AuthService, SessionAuthGuard, CsrfGuard],
})
export class AuthModule {}
