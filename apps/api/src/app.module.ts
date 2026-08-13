import { Module } from '@nestjs/common';
import { PrismaModule } from '@trace/database';
import { TraceConfigModule } from './common/config/config.module';
import { RedisModule } from './common/redis/redis.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AuthModule } from './modules/auth/auth.module';
import { DependencyHealthService } from './modules/health/dependency-health.service';
import { HealthController } from './modules/health/health.controller';
import { GithubModule } from './modules/github/github.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { ReportsModule } from './modules/reports/reports.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [TraceConfigModule, PrismaModule, RedisModule, AuthModule, GithubModule, RepositoriesModule, WebhooksModule, ActivityModule, ReportsModule],
  controllers: [HealthController],
  providers: [DependencyHealthService],
})
export class AppModule {}
