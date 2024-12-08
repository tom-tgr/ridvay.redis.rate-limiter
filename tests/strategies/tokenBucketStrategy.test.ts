import {Redis} from 'ioredis';
import {GenericContainer, StartedTestContainer} from "testcontainers";
import {TokenBucketStrategy, WindowType} from "../../src/strategies/tokenBucketStrategy";

describe('TokenBucketStrategy', () => {
    let redis: Redis;
    let strategy: TokenBucketStrategy;
    let container: StartedTestContainer;

    beforeAll(async () => {
        container = await new GenericContainer("redis")
            .withExposedPorts(6379)
            .start();

        redis = new Redis({
            host: container.getHost(),
            port: container.getMappedPort(6379)         // Update with your Redis port
        });
        strategy = new TokenBucketStrategy(redis, 5, '10 s', 1);
    },30000);

    afterEach(async () => {
        await redis.flushall();
    });

    it('should allow requests within capacity', async () => {
        for (let i = 0; i < 5; i++) {
            const result = await strategy.isAllowed('user1');
            expect(result.success).toBe(true);
        }
    });

    it('should refill tokens after interval', async () => {
        for (let i = 0; i < 5; i++) {
            await strategy.isAllowed('user1');
        }

        // Should be empty now
        const result1 = await strategy.isAllowed('user1');
        expect(result1.success).toBe(false);

        // Wait for refill (add a small buffer)
        await new Promise(resolve => setTimeout(resolve, 11000));

        const result2 = await strategy.isAllowed('user1');
        expect(result2.success).toBe(true);
    }, 30000);

    it('should handle multiple identifiers', async () => {
        const result1 = await strategy.isAllowed('user1');
        const result2 = await strategy.isAllowed('user2');

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
    });

    it('should reset bucket', async () => {
        await strategy.isAllowed('user1');
        await strategy.reset('user1');
        const result = await strategy.isAllowed('user1');
        expect(result.success).toBe(true);
    });

    it('should work with fixed window', async () => {

        strategy = new TokenBucketStrategy(redis, 100000, '6 h', 25000);

        // Take 25k tokens
        const result1 = await strategy.isAllowed('user1');
        expect(result1.success).toBe(true);
        expect(result1.remaining).toBe(75000);

        strategy = new TokenBucketStrategy(redis, 100000, '6 h', 50000);
        // Take another 50k tokens
        const result2 = await strategy.isAllowed('user1');
        expect(result2.success).toBe(true);
        expect(result2.remaining).toBe(25000);

        strategy = new TokenBucketStrategy(redis, 100000, '6 h', 500000);
        // Try to take more than remaining - should fail
        const result3 = await strategy.isAllowed('user1');
        expect(result3.success).toBe(false);
    });

    it('should work with sliding window', async () => {
        strategy = new TokenBucketStrategy(redis, 100000, '6 h', 25000, WindowType.SLIDING);

        // First request should start with full capacity
        const result1 = await strategy.isAllowed('user1');
        expect(result1.success).toBe(true);
        expect(result1.remaining).toBe(75000); // 100000 - 25000

        // Small delay to ensure different timestamp
        await new Promise(resolve => setTimeout(resolve, 100));

        // Second request should show remaining tokens from previous request
        const result2 = await strategy.isAllowed('user1');
        expect(result2.success).toBe(true);
        expect(result2.remaining).toBe(50000); // 75000 - 25000

        // Test with longer delay to verify refill
        await new Promise(resolve => setTimeout(resolve, 2000));

        const result3 = await strategy.isAllowed('user1');
        expect(result3.success).toBe(true);
        // Remaining should be slightly higher due to refill
        expect(result3.remaining).toBeGreaterThan(25000);
    });

    it('should update tokens after execution', async () => {
        strategy = new TokenBucketStrategy(redis, 100000, '6 h', 1, WindowType.SLIDING);

        // First check availability
        const result1 = await strategy.isAllowed('user1');
        expect(result1.success).toBe(true);
        expect(result1.remaining).toBe(99999);

        // Update with actual token usage
        const result2 = await strategy.updateTokens('user1', 25000);
        expect(result2.success).toBe(true);
        expect(result2.remaining).toBe(74999);

        // Try to update with more tokens than available
        const result3 = await strategy.updateTokens('user1', 80000);
        expect(result3.success).toBe(false);
        expect(result3.remaining).toBe(74999);
    });

});
