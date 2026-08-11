import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { loadConfig } from '@trace/config';
import { PrismaModule } from '@trace/database';
import { TRACE_CONFIG } from './common/config/config.token';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RedisService } from './common/redis/redis.service';
import { DependencyHealthService } from './modules/health/dependency-health.service';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [
    {
      provide: TRACE_CONFIG,
      useFactory: () => loadConfig(process.env),
    },
    RedisService,
    DependencyHealthService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*splat', method: RequestMethod.ALL });
  }
}
