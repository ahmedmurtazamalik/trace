
import { PrismaService } from '../src/prisma.service';

describe('PrismaService lifecycle', () => {
  const service = new PrismaService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects when its module initializes', async () => {
    const connect = jest.spyOn(service, '$connect').mockResolvedValue();

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('keeps the process live when PostgreSQL is temporarily unavailable', async () => {
    jest.spyOn(service, '$connect').mockRejectedValue(new Error('connection details must not escape'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('disconnects when its module is destroyed', async () => {
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
