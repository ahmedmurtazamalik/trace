import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/prisma.service';

describe('PrismaService lifecycle', () => {
  const service = new PrismaService();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects when its module initializes', async () => {
    const connect = vi.spyOn(service, '$connect').mockResolvedValue();

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledOnce();
  });

  it('disconnects when its module is destroyed', async () => {
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
