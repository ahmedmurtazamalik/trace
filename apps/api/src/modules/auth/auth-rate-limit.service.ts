import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
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
}
