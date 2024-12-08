import { Redis } from 'ioredis';
import { RateLimiterStrategy, RateLimiterResult } from '../interfaces/RateLimiterStrategy';

export enum WindowType {
    SLIDING = 'sliding',
    FIXED = 'fixed'
}

export class TokenBucketStrategy implements RateLimiterStrategy {
    private readonly redis: Redis;
    private readonly refillRate: number;
    private readonly interval: number;
    private readonly capacity: number;
    private readonly prefix: string;
    private readonly takeRate: number;
    private readonly windowType: WindowType;

    constructor(
        redis: Redis,
        capacity: number,
        interval: string | number,
        takeRate: number = 1,
        windowType: WindowType = WindowType.FIXED,
        refillRate: number | null = null,
        prefix: string = 'token-bucket:'
    ) {
        this.redis = redis;
        this.capacity = capacity;
        this.interval = typeof interval === 'string' ?
            this.parseInterval(interval) :
            interval;
        this.refillRate = refillRate ?? capacity;
        this.prefix = prefix;
        this.takeRate = takeRate;
        this.windowType = windowType;
    }

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

    private getKey(identifier: string): string {
        if (this.windowType === WindowType.FIXED) {
            const windowStart = Math.floor(Date.now() / this.interval) * this.interval;
            return `${this.prefix}/bt/{${identifier}}/${windowStart}`;
        }
        return `${this.prefix}${identifier}`;
    }

    private getCurrentWindow(): number {
        return Math.floor(Date.now() / this.interval) * this.interval;
    }

    async isAllowed(identifier: string): Promise<RateLimiterResult> {
        const key = this.getKey(identifier);
        const now = Date.now();

        let val: [number, number, number];

        if (this.windowType === WindowType.SLIDING) {
            val = await this.redis.eval(
                this.slidingWindowScript,
                1,
                key,
                now,
                this.capacity,
                this.interval,
                this.refillRate,
                this.takeRate
            ) as [number, number, number];
        } else {
            val = await this.redis.eval(
                this.fixedWindowScript,
                1,
                key,
                now,
                this.capacity,
                this.interval,
                this.takeRate
            ) as [number, number, number];
        }

        const [success, remaining, reset] = val;

        return {
            success: success === 1,
            remaining: remaining,
            reset: reset,
            limit: this.capacity,
            name: 'TokenBucketStrategy'
        };
    }

    fixedWindowScript = `
            local key = KEYS[1]
            local now = tonumber(ARGV[1])
            local capacity = tonumber(ARGV[2])
            local windowSize = tonumber(ARGV[3])
            local takeRate = tonumber(ARGV[4])

            local bucket = redis.call('hgetall', key)
            local tokens = tonumber(bucket[2] or capacity)
            local windowStart = tonumber(bucket[4] or now)

            if tokens < takeRate then
                return {0, tokens, windowStart + windowSize}
            end

            tokens = tokens - takeRate
            redis.call('hmset', key, 
                'tokens', tokens,
                'windowStart', windowStart
            )
            redis.call('pexpire', key, windowSize)

            return {1, tokens, windowStart + windowSize}
        `;

    slidingWindowScript = `
            local key = KEYS[1]
            local now = tonumber(ARGV[1])
            local capacity = tonumber(ARGV[2])
            local interval = tonumber(ARGV[3])
            local refillRate = tonumber(ARGV[4])
            local takeRate = tonumber(ARGV[5])

            -- Get current bucket state or initialize
            local bucket = redis.call('hgetall', key)
            local tokens
            local lastRefill

            -- Check if bucket exists
            if #bucket == 0 then
                tokens = capacity
                lastRefill = now
            else
                tokens = tonumber(bucket[2])
                lastRefill = tonumber(bucket[4])
            end

            -- Calculate token refill
            local timePassed = now - lastRefill
            local tokensToAdd = math.floor(timePassed * refillRate / interval)
            tokens = math.min(capacity, tokens + tokensToAdd)

            -- Check if enough tokens are available
            if tokens < takeRate then
                return {0, tokens, lastRefill + interval}
            end

            -- Consume tokens
            tokens = tokens - takeRate

            -- Update bucket
            redis.call('hmset', key, 
                'tokens', tokens,
                'lastRefill', now
            )
            redis.call('pexpire', key, interval)

            return {1, tokens, now + interval}
        `;
    async reset(identifier: string): Promise<void> {
        if (this.windowType === WindowType.FIXED) {
            const currentWindow = this.getCurrentWindow();
            const key = `${this.prefix}${identifier}:${currentWindow}`;
            await this.redis.del(key);
        } else {
            await this.redis.del(this.getKey(identifier));
        }
    }

    async updateTokens(identifier: string, tokensToSubtract: number): Promise<RateLimiterResult> {
        const key = this.getKey(identifier);
        const now = Date.now();

        let val: [number, number, number];

        if (this.windowType === WindowType.SLIDING) {
            val = await this.redis.eval(
                this.updateTokensSliding,
                1,
                key,
                now,
                this.capacity,
                this.interval,
                this.refillRate,
                tokensToSubtract
            ) as [number, number, number];
        } else {
            val = await this.redis.eval(
                this.updateTokensFixed,
                1,
                key,
                now,
                this.capacity,
                this.interval,
                tokensToSubtract
            ) as [number, number, number];
        }

        const [success, remaining, reset] = val;

        return {
            success: success === 1,
            remaining: remaining,
            reset: reset,
            limit: this.capacity,
            name: 'TokenBucketStrategy'
        };
    }

    updateTokensFixed = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local capacity = tonumber(ARGV[2])
        local windowSize = tonumber(ARGV[3])
        local tokensToSubtract = tonumber(ARGV[4])

        local bucket = redis.call('hgetall', key)
        local tokens = tonumber(bucket[2] or capacity)
        local windowStart = tonumber(bucket[4] or now)

        if tokens < tokensToSubtract then
            return {0, tokens, windowStart + windowSize}
        end

        tokens = tokens - tokensToSubtract
        redis.call('hmset', key, 
            'tokens', tokens,
            'windowStart', windowStart
        )
        redis.call('pexpire', key, windowSize)

        return {1, tokens, windowStart + windowSize}
    `;

    updateTokensSliding = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local capacity = tonumber(ARGV[2])
        local interval = tonumber(ARGV[3])
        local refillRate = tonumber(ARGV[4])
        local tokensToSubtract = tonumber(ARGV[5])

        local bucket = redis.call('hgetall', key)
        local tokens
        local lastRefill

        if #bucket == 0 then
            tokens = capacity
            lastRefill = now
        else
            tokens = tonumber(bucket[2])
            lastRefill = tonumber(bucket[4])
        end

        local timePassed = now - lastRefill
        local tokensToAdd = math.floor(timePassed * refillRate / interval)
        tokens = math.min(capacity, tokens + tokensToAdd)

        if tokens < tokensToSubtract then
            return {0, tokens, lastRefill + interval}
        end

        tokens = tokens - tokensToSubtract

        redis.call('hmset', key, 
            'tokens', tokens,
            'lastRefill', now
        )
        redis.call('pexpire', key, interval)

        return {1, tokens, now + interval}
    `;
}
