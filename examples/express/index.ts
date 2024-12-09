import express from 'express';
import Redis from 'ioredis';
import { ConcurrencyStrategy } from '../../src/strategies/concurrencyStrategy';
import { FixedWindowStrategy,} from '../../src/strategies/fixedWindowStrategy';
import { TokenBucketStrategy,  } from '../../src/strategies/tokenBucketStrategy';
import { Ratelimit } from '../../src/ratelimit';

const app = express();
const redis = new Redis('redis://localhost:6379');

// Create different rate limiting strategies
const fixedWindow = new FixedWindowStrategy(redis, {
    maxRequests: 5,
    window: '1 m' // 5 requests per minute
});
const tokenBucket = new TokenBucketStrategy(redis, {
    capacity: 10,
    interval: 2,
    refillRate: 2
});
const concurrency = new ConcurrencyStrategy(redis, {
    maxConcurrentRequests: 3,
    timeout: 5000,
});

// Middleware factory
const createRateLimitMiddleware = (limiter: Ratelimit) => {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const identifier = req.ip || "127.0.0.1" ; // Use IP as identifier
            const results = await limiter.isAllowed(identifier);
            
            // Find the most restrictive result
            const mostRestrictive = results.reduce((prev, curr) => 
                (!curr.success || (prev.remaining > curr.remaining)) ? curr : prev
            );

            // Set rate limit headers for all limiters
            results.forEach((result, index) => {
                res.set({
                    [`X-RateLimit-${result.name}-Limit`]: result.limit.toString(),
                    [`X-RateLimit-${result.name}-Remaining`]: result.remaining.toString(),
                    [`X-RateLimit-${result.name}-Reset`]: result.reset.toString(),
                });
            });

            if (mostRestrictive.success) {
                next();
            } else {
                res.status(429).json({
                    error: 'Too Many Requests',
                    limiter: mostRestrictive.name,
                    retryAfter: mostRestrictive.reset - Date.now(),
                });
            }
        } catch (error) {
            next(error);
        }
    };
};

// Create rate limiters
const fixedWindowLimiter = new Ratelimit({ redis, limiter: fixedWindow });
const tokenBucketLimiter = new Ratelimit({ redis, limiter: tokenBucket });
const concurrencyLimiter = new Ratelimit({ redis, limiter: concurrency });

// Routes with different rate limiting strategies
app.get('/fixed-window', 
    createRateLimitMiddleware(fixedWindowLimiter),
    (req, res) => {
        res.json({ message: 'Fixed Window Rate Limited Route' });
    }
);

app.get('/token-bucket',
    createRateLimitMiddleware(tokenBucketLimiter),
    (req, res) => {
        res.json({ message: 'Token Bucket Rate Limited Route' });
    }
);

app.get('/concurrency',
    createRateLimitMiddleware(concurrencyLimiter),
    (req, res) => {
        res.json({ message: 'Concurrency Limited Route' });
    }
);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
