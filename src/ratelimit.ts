import { Redis } from 'ioredis';
import {RateLimiterResult, RateLimiterStrategy} from './interfaces/rateLimiterStrategy';


export class Ratelimit {
    private redis: Redis;
    private limiters: RateLimiterStrategy[];

    constructor(options: {
        redis: Redis;
        limiter: RateLimiterStrategy | RateLimiterStrategy[];
    }) {
        this.redis = options.redis;
        this.limiters = Array.isArray(options.limiter) ? options.limiter : [options.limiter];
    }

    async isAllowed(identifier: string): Promise<RateLimiterResult[]> {

        let checkedLimiters: RateLimiterResult[] = [];

        for (const limiter of this.limiters) {
            const result = await limiter.isAllowed(identifier);
            checkedLimiters.push(result);
            if (!result.success) {
                return checkedLimiters;
            }
        }

       return checkedLimiters
    }

    async reset(identifier: string): Promise<void> {
        await Promise.all(
            this.limiters.map(limiter => limiter.reset(identifier))
        );
    }
}