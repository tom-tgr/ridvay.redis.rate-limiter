import { Redis } from 'ioredis';
import { ConcurrencyStrategy } from '../../src/strategies/concurrencyStrategy';
import {GenericContainer, StartedTestContainer} from "testcontainers";

describe('ConcurrencyStrategy', () => {
    let strategy: ConcurrencyStrategy;

    let redis: Redis;
    let container: StartedTestContainer;

    beforeAll(async () => {
        container = await new GenericContainer("redis")
            .withExposedPorts(6379)
            .start();

    }, 30000);

    beforeEach(() => {
        redis = new Redis({
            host: container.getHost(),
            port: container.getMappedPort(6379)         // Update with your Redis port
        });

        strategy = new ConcurrencyStrategy(redis, {
            maxConcurrentRequests: 1,
            timeout: 1000, // 1 second for testing
        });
    });

    afterEach(async () => {
        await redis.flushall();
        await redis.quit();
    });

    it('should allow single request', async () => {
        const result = await strategy.isAllowed('test-user');
        expect(result.success).toBe(true);
    });

    it('should block concurrent requests', async () => {
        const identifier = 'test-user';

        await strategy.isAllowed(identifier);
        const result = await strategy.isAllowed(identifier);

        expect(result.success).toBe(false);
    });

    it('should allow request after release', async () => {
        const identifier = 'test-user';

        await strategy.isAllowed(identifier);
        await strategy.release(identifier);

        const result = await strategy.isAllowed(identifier);
        expect(result.success).toBe(true);
    });

    it('should handle wrap method correctly', async () => {
        const identifier = 'test-user';
        let count = 0;

        const result = await strategy.wrap(identifier, async () => {
            count++;
            return count;
        });
            
        expect(result).toBe(1);
    });
});