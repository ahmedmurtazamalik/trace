import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(scope: string, principal: string, limit: number, windowMs: number): Promise<void> {
    const principalHash = createHash('sha256').update(principal).digest('hex');
    const key = `trace:auth-limit:${scope}:${principalHash}`;
    let count: number;
    try {
      count = Number(await this.redis.eval(RATE_LIMIT_SCRIPT, 1, key, windowMs));
    } catch {
      throw new HttpException(
        { code: 'SERVICE_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (count > limit) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async withLock(scope: string, identity: string, ttlMs: number, work: () => Promise<void>): Promise<boolean> {
    const digest = createHash('sha256').update(identity).digest('hex');
    const key = `trace:auth-lock:${scope}:${digest}`;
    const owner = randomUUID();
    try {
      const acquired = await this.redis.set(key, owner, 'PX', ttlMs, 'NX');
      if (acquired !== 'OK') return false;
      try {
        await work();
      } finally {
        await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, owner);
      }
      return true;
    } catch {
      throw new HttpException(
        { code: 'SERVICE_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
