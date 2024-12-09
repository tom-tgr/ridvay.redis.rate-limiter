# Ridvay Rate Limiter

A high-performance, Redis-based rate limiting library with multiple strategies for distributed systems. This library provides flexible rate limiting solutions with support for fixed window, token bucket, and concurrent request limiting strategies.

## Features

- 🚀 Multiple rate limiting strategies:
  - Fixed Window Rate Limiting
  - Token Bucket Algorithm
  - Concurrent Request Limiting
- 💪 Redis-based distributed rate limiting
- 🔒 Thread-safe and race-condition-free using Redis Lua scripts
- 📊 Built-in performance monitoring and statistics
- 🎯 TypeScript support with full type definitions
- ⚡ High performance with minimal overhead
- 🔄 Configurable fallback mechanisms
- 📝 Comprehensive logging and error reporting

## Installation

TODO:

## Quick Start
```ts
import { Redis } from 'ioredis';
import { Ratelimit, TokenBucketStrategy, FixedWindowStrategy, ConcurrencyStrategy } from 'ridvay-rate-limiter';

// Initialize Redis
const redis = new Redis({
  host: 'localhost',
  port: 6379
});

// Create rate limiter with multiple strategies
const rateLimiter = new Ratelimit({
  redis,
  limiter: [
    // Allow 100 requests per minute
    new FixedWindowStrategy(redis, {
      maxRequests: 100,
      window: "60 s"
    }),
    
    // Token bucket: 300k tokens per 5 hours
    new TokenBucketStrategy(redis, {
      capacity: 300000,
      interval: "5 h",
      refillRate: 300000 / (5 * 60 * 60)
    }),
    
    // Max 5 concurrent requests
    new ConcurrencyStrategy(redis, {
      maxConcurrentRequests: 5
    })
  ]
});

// Usage example
async function handleRequest(userId: string) {
  try {
    const result = await rateLimiter.isAllowed(userId);
    
    if (result.success) {
      // Process request
      return 'Success';
    } else {
      throw new Error('Rate limit exceeded');
    }
  } catch (error) {
    // Handle rate limit error
    console.error('Rate limit error:', error);
    throw error;
  }
}
```

Fixed Window Strategy
Limits requests within a fixed time window.
```ts
const fixedWindow = new FixedWindowStrategy(redis, {
  maxRequests: 100,  // max requests
  window: "60 s",    // window size
  prefix: "app:"     // optional prefix
});
```
Token Bucket Strategy
Implements token bucket algorithm for smooth rate limiting.
```ts
// Basic usage
const tokenBucket = new TokenBucketStrategy(redis, {
  capacity: 1000,         // bucket capacity (max tokens)
  interval: "1 h",        // interval
  takeRate: 1,           // tokens to consume per request
  windowType: WindowType.FIXED,
  refillRate: null,      // auto-calculated refill rate
  prefix: 'app:tokens:'  // prefix for Redis keys
});

// Advanced configurations:

// 1. Fixed window with 300k tokens per 5 hours
const apiLimiter = new TokenBucketStrategy(redis, {
  capacity: 300000,      // 300k tokens capacity
  interval: "5 h",       // 5-hour window
  takeRate: 1,          // consume 1 token per request
  windowType: WindowType.FIXED,
  refillRate: 300000 / (5 * 3600) // refill rate (tokens per second)
});

// 2. Sliding window with variable token consumption
const mlApiLimiter = new TokenBucketStrategy(redis, {
  capacity: 100000,      // 100k tokens capacity
  interval: "1 h",       // 1-hour sliding window
  takeRate: 10,         // consume 10 tokens per request
  windowType: WindowType.SLIDING,
  refillRate: null,     // auto-calculated refill rate
  prefix: 'ml-api:'     // custom prefix
});

// 3. High-throughput configuration
const highThroughputLimiter = new TokenBucketStrategy(redis, {
  capacity: 1000000,    // 1M tokens
  interval: "1 m",      // 1-minute window
  takeRate: 1,         // 1 token per request
  windowType: WindowType.FIXED,
  refillRate: 1000,    // 1000 tokens per second refill
  prefix: 'high-throughput:'
});
```
Concurrency Strategy
Limits concurrent requests.
```ts
const concurrency = new ConcurrencyStrategy(redis, {
  maxConcurrentRequests: 5,
  timeout: 30000,  // 30 seconds
  prefix: 'app:concurrent:'
});
```
Advanced Usage
Express Middleware
```
import { RateLimitExceededError } from 'ridvay-rate-limiter';

const rateLimitMiddleware = (rateLimiter: Ratelimit) => 
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await rateLimiter.isAllowed(req.ip);
      
      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.reset);
      
      if (!result.success) {
        return res.status(429).json({
          error: 'Too Many Requests',
          retryAfter: result.reset - Date.now()
        });
      }
      
      next();
    } catch (error) {
      next(error);
    }
};
```
Custom Strategy
Implement your own strategy by extending the RateLimiterStrategy interface:

```ts
import { RateLimiterStrategy, RateLimiterResult } from 'ridvay-rate-limiter';

class CustomStrategy implements RateLimiterStrategy {
  async isAllowed(identifier: string): Promise<RateLimiterResult> {
    // Your implementation
  }

  async reset(identifier: string): Promise<void> {
    // Your implementation
  }
}
```

## Benchmark

 Platform info:
     Windows_NT 10.0.19045 x64
     Node.JS: 20.9.0
     V8: 11.3.244.8-node.16
     CPU: AMD Ryzen 9 5950X 16-Core Processor             × 32
     Memory: 32 GB
FixedWindowStrategy with local Redis server
- Running 'One user'...
√ One user*              2,519 ops/sec
  One user*              -1.8%      (2,519 ops/sec)   (avg: 396μs)
- Running 'Different user'...
√ Different user*        2,565 ops/sec
  Different user* (#)       0%      (2,565 ops/sec)   (avg: 389μs)


