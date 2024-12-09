import {Redis} from "ioredis";
import {GenericContainer, StartedTestContainer} from "testcontainers";
import {FixedWindowStrategy} from "../src/strategies/fixedWindowStrategy";
import {TokenBucketStrategy} from "../src/strategies/tokenBucketStrategy";
import {ConcurrencyStrategy} from "../src/strategies/concurrencyStrategy";

const Benchmarkify:any = require("benchmarkify");

describe('Benchmark', () => {

    let redis: Redis;
    let container: StartedTestContainer;


    beforeAll(async () => {
        container = await new GenericContainer('redis')
            .withExposedPorts(6379)
            .start();

        redis = new Redis({
            host: container.getHost(),
            port: container.getMappedPort(6379)         // Update with your Redis port
        });
    }, 30000);

    it('benchmark ', async () => {
        const fixedWindowStrategy = new FixedWindowStrategy(redis, {
            maxRequests: 10000000,
            window: 1000 * 60 * 60
        });
        const tokenBucketStrategy = new TokenBucketStrategy(redis, {
            capacity: 10000000,
            interval: 1000 * 60 * 60
        });
        const concurrencyStrategy = new ConcurrencyStrategy(redis, { maxConcurrentRequests: 10000, timeout: 1000 });

        const benchmark = new Benchmarkify("Rate Limiter Benchmark", { description: "This is a common benchmark", chartImage: false, print: false });
        benchmark.createSuite("FixedWindowStrategy", { time: 3000 })
            .add("One user", async (done:any)=> {
                await fixedWindowStrategy.isAllowed("test-user");
                done();
            })
            .ref("Different user", async (done:any) => {
                await fixedWindowStrategy.isAllowed(Math.random().toString());
                done();
            });

        benchmark.createSuite("TokenBucketStrategy", { time: 3000 })
            .add("One user", async (done:any)=> {
                await tokenBucketStrategy.isAllowed("test-user");
                done();
            })
            .ref("Different user", async (done:any) => {
                await tokenBucketStrategy.isAllowed(Math.random().toString());
                done();
            });

        benchmark.createSuite("ConcurrencyStrategy", { time: 3000 })
            .add("One user", async (done:any)=> {
                await concurrencyStrategy.isAllowed("test-user");
                done();
            })
            .ref("with release", async (done:any) => {
                await concurrencyStrategy.isAllowed("test-user");
                await concurrencyStrategy.release("test-user");
                done();
            })
            .ref("Different user", async (done:any) => {
                await concurrencyStrategy.isAllowed(Math.random().toString());
                done();
            });

       let result = await benchmark.run();
       //console.log(result);
    }, 60000);

});
