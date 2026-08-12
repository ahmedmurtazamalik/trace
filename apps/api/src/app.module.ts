import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { PrismaModule } from '@trace/database';
import { TraceConfigModule } from './common/config/config.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RedisModule } from './common/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { DependencyHealthService } from './modules/health/dependency-health.service';
import { HealthController } from './modules/health/health.controller';
import { GithubModule } from './modules/github/github.module';

@Module({
  imports: [TraceConfigModule, PrismaModule, RedisModule, AuthModule, GithubModule],
  controllers: [HealthController],
  providers: [DependencyHealthService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*splat', method: RequestMethod.ALL });
  }
}
