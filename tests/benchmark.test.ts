import {Redis} from "ioredis";
import {GenericContainer, StartedTestContainer} from "testcontainers";
import {FixedWindowStrategy} from "../src/strategies/fixedWindowStrategy";

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
        const strategy = new FixedWindowStrategy(redis,10000000, 1000 * 60 * 60);

        const benchmark = new Benchmarkify("Rate Limiter Benchmark", { description: "This is a common benchmark", chartImage: true }).printHeader();
        benchmark.createSuite("FixedWindowStrategy", { time: 3000 })
            .add("One user", async (done:any)=> {
                await strategy.isAllowed("test-user");
                done();
            })
            .ref("Different user", async (done:any) => {
                await strategy.isAllowed(Math.random().toString());
                done();
            });

       let result = await benchmark.run();

       console.log(result);
    }, 60000);

});