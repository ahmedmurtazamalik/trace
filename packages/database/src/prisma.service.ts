import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly prismaLogger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      this.prismaLogger.warn('PostgreSQL connection is unavailable; readiness will remain false.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
