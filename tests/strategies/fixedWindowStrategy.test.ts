import { Redis } from 'ioredis';
import { FixedWindowStrategy } from '../../src/strategies/fixedWindowStrategy';
import {
    StartedTestContainer,
    GenericContainer
} from "testcontainers";

describe('FixedWindowStrategy', () => {
    let redis: Redis;
    let container: StartedTestContainer;
    let strategy: FixedWindowStrategy;

    beforeAll(async () => {
        container = await new GenericContainer("redis")
            .withExposedPorts(6379)
            .start();

    }, 30000);

    beforeEach(async () => {
        redis = new Redis({
            host: container.getHost(),
            port: container.getMappedPort(6379),
        });
    });

    afterEach(async () => {
        await redis.flushall();
    });

    it('should allow requests within limit', async () => {
        const identifier = 'test-user';
        strategy = new FixedWindowStrategy(redis, 1, 1000);
        const result1 = await strategy.isAllowed(identifier);
        const result2 = await strategy.isAllowed(identifier);

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(false);
    });

    it('should block requests over limit', async () => {
        const identifier = 'test-user';

        strategy = new FixedWindowStrategy(redis, 0, 1000);
        const result = await strategy.isAllowed(identifier);

        expect(result.success).toBe(false);
    });

    it('should reset after window expires', async () => {
        const identifier = 'test-user';
        strategy = new FixedWindowStrategy(redis, 1, 1000);
        const result1 = await strategy.isAllowed(identifier);
        const result2 = await strategy.isAllowed(identifier);

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 1000))

        const result = await strategy.isAllowed(identifier);
        expect(result.success).toBe(true);
    });
});