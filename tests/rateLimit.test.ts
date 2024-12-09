import { Redis } from 'ioredis';
import { Ratelimit } from '../src/ratelimit';
import { RateLimiterResult, RateLimiterStrategy } from '../src/interfaces/rateLimiterStrategy';
import { FixedWindowStrategy } from '../src/strategies/fixedWindowStrategy';
import { ConcurrencyStrategy } from '../src/strategies/concurrencyStrategy';
import {GenericContainer, StartedTestContainer} from "testcontainers";

interface MockStrategyOptions extends Partial<RateLimiterResult> {
    resetFn?: () => Promise<void>;
}

describe('Ratelimit', () => {
    let redis: Redis;
    let ratelimit: Ratelimit;
    let container: StartedTestContainer;

    beforeAll(async () => {
        container = await new GenericContainer("redis")
            .withExposedPorts(6379)
            .start();

        redis = new Redis({
            host: container.getHost(),
            port: container.getMappedPort(6379)         // Update with your Redis port
        });
    }, 30000);

    beforeEach(() => {
        redis = new Redis({
            host: container.getHost(),
            port: container.getMappedPort(6379)         // Update with your Redis port
        });
    });

    afterEach(async () => {
        await redis.flushall();
        await redis.quit();
    });

    // Helper function to create mock strategies
    function createMockStrategy(options: MockStrategyOptions = {}): RateLimiterStrategy {
        return {
            isAllowed: async () => ({
                success: true,
                remaining: 10,
                reset: Date.now() + 3600000,
                limit: 10,
                name: 'mock-strategy',
                ...options
            }),
            reset: options.resetFn || (async () => Promise.resolve())
        };
    }

    it('should initialize with single strategy', () => {
        const singleStrategy = new Ratelimit({
            redis,
            limiter: createMockStrategy()
        });
        expect(singleStrategy).toBeDefined();
    });

    it('should initialize with multiple strategies', () => {
        const multiStrategy = new Ratelimit({
            redis,
            limiter: [
                createMockStrategy(),
                createMockStrategy(),
                createMockStrategy()
            ]
        });
        expect(multiStrategy).toBeDefined();
    });

    it('should allow request when all strategies pass', async () => {
        ratelimit = new Ratelimit({
            redis,
            limiter: [
                createMockStrategy(),
                createMockStrategy(),
                createMockStrategy()
            ]
        });

        const result = await ratelimit.isAllowed('test-user');
        expect(result[0].success).toBe(true);
    });

    it('should return most restrictive remaining value', async () => {
        ratelimit = new Ratelimit({
            redis,
            limiter: [
                createMockStrategy({ remaining: 10 }),
                createMockStrategy({ remaining: 5 }),
                createMockStrategy({ remaining: 8 })
            ]
        });

        const result = await ratelimit.isAllowed('test-user');
        expect(result[0].remaining).toBe(10); // Should return the lowest remaining value
    });

    it('should fail fast when any strategy fails', async () => {
        const failingStrategy = createMockStrategy({
            success: false,
            remaining: 0,
            reset: Date.now() + 1000,
            limit: 5
        });

        ratelimit = new Ratelimit({
            redis,
            limiter: [
                createMockStrategy(), // This passes
                failingStrategy, // This fails
                createMockStrategy() // This shouldn't be checked
            ]
        });

        const result = await ratelimit.isAllowed('test-user');
        expect(result[1].success).toBe(false);
    });

    it('should reset all strategies', async () => {
        let resetCount = 0;
        const resetFn = async () => { resetCount++ };

        ratelimit = new Ratelimit({
            redis,
            limiter: [
                createMockStrategy({ resetFn }),
                createMockStrategy({ resetFn }),
                createMockStrategy({ resetFn })
            ]
        });

        await ratelimit.reset('test-user');
        expect(resetCount).toBe(3);
    });

    it('should handle real-world scenario with multiple requests', async () => {
        const concurrencyStrategy = new ConcurrencyStrategy(redis, { maxConcurrentRequests: 1, timeout: 5000 });
        // Using actual strategies for this test
        ratelimit = new Ratelimit({
            redis,
            limiter: [
                concurrencyStrategy,
                new FixedWindowStrategy(redis, 2, 60000),
            ]
        });

        const identifier = 'test-user-2';

        // First request should succeed
        const result1 = await ratelimit.isAllowed(identifier);
        expect(result1[0].success).toBe(true);
        expect(result1[0].name).toBe('ConcurrencyStrategy');

        const result2 = await ratelimit.isAllowed(identifier);
        expect(result2[0].success).toBe(false);
        expect(result2[0].success).toBe(false);
                // Release the first request
        await ratelimit.reset(identifier);

        // Next requests should succeed up to the fixed window limit
        const result3 = await ratelimit.isAllowed(identifier);
        await concurrencyStrategy.release(identifier);
        const result4 = await ratelimit.isAllowed(identifier);
        expect(result3[0].success).toBe(true);
        expect(result4[0].success).toBe(true);

        await concurrencyStrategy.release(identifier);
        // Fourth request should fail (fixed window limit)
        const result5 = await ratelimit.isAllowed(identifier);
        expect(result5[1].success).toBe(false);
        expect(result5[1].name).toBe('FixedWindowStrategy');
    });

    it('should handle errors in strategies gracefully', async () => {
        const errorStrategy = createMockStrategy({
            resetFn: async () => { throw new Error('Test error'); }
        });

        ratelimit = new Ratelimit({
            redis,
            limiter: [errorStrategy]
        });

        await expect(ratelimit.reset('test-user'))
            .rejects
            .toThrow('Test error');
    });
});