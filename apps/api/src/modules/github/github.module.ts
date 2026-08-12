import { Module } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { FakeGithubAuthorizationAdapter, RealGithubAuthorizationAdapter, UnavailableGithubAuthorizationAdapter } from '@trace/github';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { AuthModule } from '../auth/auth.module';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { GITHUB_AUTHORIZATION_ADAPTER } from './github.tokens';

@Module({
  imports: [AuthModule],
  controllers: [GithubController],
  providers: [
    GithubService,
    {
      provide: GITHUB_AUTHORIZATION_ADAPTER,
      inject: [TRACE_CONFIG],
      useFactory: (config: TraceConfig) => {
        if (config.nodeEnv === 'test') return new FakeGithubAuthorizationAdapter();
        if (config.github.clientId === undefined || config.github.clientSecret === undefined) {
          return new UnavailableGithubAuthorizationAdapter();
        }
        return new RealGithubAuthorizationAdapter({ clientId: config.github.clientId, clientSecret: config.github.clientSecret });
      },
    },
  ],
})
export class GithubModule {}
