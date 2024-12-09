import { Redis } from 'ioredis';
import { RateLimiterStrategy, RateLimiterResult } from '../interfaces/rateLimiterStrategy';

export class FixedWindowStrategy implements RateLimiterStrategy {
    private readonly redis: Redis;
    private readonly windowMs: number;
    private readonly maxRequests: number;
    private readonly prefix: string;

    constructor(
        redis: Redis,
        maxRequests: number,
        windowMs: number | string,
        prefix: string = ''
    ) {
        this.redis = redis;
        this.maxRequests = maxRequests;
        this.windowMs = typeof windowMs === 'string' ?
            this.parseInterval(windowMs) :
            windowMs;
        this.prefix = prefix;
    }

    private getKey(identifier: string): string {
        const window = Math.floor(Date.now() / this.windowMs);
        return `${this.prefix}/fx/{${identifier}}/${window}`;
    }

    async isAllowed(identifier: string): Promise<RateLimiterResult> {
        const key = this.getKey(identifier);

        const result = await this.redis.eval(
            this.script,
            1,
            key,
            this.maxRequests,
            this.windowMs
        ) as [number, number, number];

        const [success, remaining, _] = result;

        return {
            success: success === 1,
            remaining: remaining,
            reset:Math.floor(Date.now() / 1000) + Math.floor(this.windowMs / 1000),
            limit: this.maxRequests,
            name: 'FixedWindowStrategy'
        };
    }

    async reset(identifier: string): Promise<void> {
        const key = this.getKey(identifier);
        await this.redis.del(key);
    }

    script = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      
      local count = redis.call('incr', key)
      if count == 1 then
        redis.call('pexpire', key, window)
      end
      
      return {count <= limit, limit - count, window}
    `;

    private parseInterval(interval: string): number {
        const [amount, unit] = interval.split(' ');
        const multiplier = {
            ms: 1,
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
        }[unit.toLowerCase()] || 1000;

        return parseInt(amount) * multiplier;
    }
}