import { Redis } from 'ioredis';
import { RateLimiterStrategy, RateLimiterResult } from '../interfaces/rateLimiterStrategy';
import { RateLimitExceededError } from '../errors/rateLimitExceededError';

export interface ConcurrencyOptions {
    maxConcurrentRequests: number;
    timeout?: number; // Lock timeout in ms
    prefix?: string;
}

export class ConcurrencyStrategy implements RateLimiterStrategy {
    private readonly redis: Redis;
    private readonly options: Required<ConcurrencyOptions>;

    constructor(redis: Redis, options: ConcurrencyOptions) {
        this.redis = redis;
        this.options = {
            timeout: 30000, // 30 seconds default
            prefix: 'concurrency:',
            ...options,
        };
    }

    private getKey(identifier: string): string {
        return `${this.options.prefix}/cc/{${identifier}}/count`;
    }

    async isAllowed(identifier: string): Promise<RateLimiterResult> {
        const key = this.getKey(identifier);
        const now = Date.now();

        // Using Lua script for atomic operation
        const script = `
            local key = KEYS[1]
            local max_concurrent = tonumber(ARGV[1])
            local timeout = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])
            
            -- Get current count
            local count = redis.call('get', key)
            
            -- If no count exists, initialize it
            if not count then
                redis.call('set', key, '1', 'PX', timeout)
                return {1, max_concurrent - 1, timeout, 1}
            end
            
            count = tonumber(count)
            
            -- Check if under limit
            if count >= max_concurrent then
                return {0, 0, timeout, count}
            end
            
            -- Increment count
            local new_count = redis.call('incr', key)
            redis.call('pexpire', key, timeout)
            
            return {1, max_concurrent - new_count, timeout, new_count}
        `;

        try {
            const result = await this.redis.eval(
                script,
                1,
                key,
                this.options.maxConcurrentRequests.toString(),
                this.options.timeout.toString(),
                now.toString()
            ) as [number, number, number, number];

            const [success, remaining, reset, currentCount] = result;

            return {
                success: success === 1,
                remaining: remaining,
                reset: now + reset,
                limit: this.options.maxConcurrentRequests,
                name: 'ConcurrencyStrategy',
                metadata: {
                    currentConcurrentRequests: currentCount
                }
            };
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                throw error;
            }
            throw new Error('Failed to check concurrency limit');
        }
    }

    async release(identifier: string): Promise<void> {
        const key = this.getKey(identifier);

        const script = `
            local key = KEYS[1]
            local count = redis.call('get', key)
            
            if not count then
                return 0
            end
            
            count = tonumber(count)
            
            if count <= 1 then
                return redis.call('del', key)
            end
            
            return redis.call('decr', key)
        `;

        await this.redis.eval(script, 1, key);
    }

    async reset(identifier: string): Promise<void> {
        const key = this.getKey(identifier);
        await this.redis.del(key);
    }

    // Utility method to wrap async functions
    async wrap<T>(identifier: string, fn: () => Promise<T>): Promise<T> {
        const result = await this.isAllowed(identifier);

        if (!result.success) {
            throw new RateLimitExceededError(
                `Concurrent requests limit exceeded. Current count: ${
                    result.remaining
                }, Limit: ${this.options.maxConcurrentRequests}`
            );
        }

        try {
            return await fn();
        } finally {
            await this.release(identifier);
        }
    }
}