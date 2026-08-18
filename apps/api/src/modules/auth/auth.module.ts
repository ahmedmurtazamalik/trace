import { Module } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { AuthController } from './auth.controller';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import {
  DevelopmentPasswordResetDelivery,
  InMemoryPasswordResetDelivery,
  PASSWORD_RESET_DELIVERY,
  UnavailablePasswordResetDelivery,
} from './password-reset-delivery';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitService,
    SessionAuthGuard,
    CsrfGuard,
    {
      provide: PASSWORD_RESET_DELIVERY,
      inject: [TRACE_CONFIG],
      useFactory: (config: TraceConfig) => {
        if (config.nodeEnv === 'test') return new InMemoryPasswordResetDelivery();
        if (config.nodeEnv === 'development' && config.passwordReset.outboxDirectory !== undefined) {
          return new DevelopmentPasswordResetDelivery(config.passwordReset.outboxDirectory, config.frontendOrigin);
        }
        return new UnavailablePasswordResetDelivery();
      },
    },
  ],
  exports: [AuthService, AuthRateLimitService, SessionAuthGuard, CsrfGuard],
})
export class AuthModule {}
