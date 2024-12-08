# Express Rate Limiting Example

This example demonstrates how to use the rate limiting package with Express.js. It shows three different rate limiting strategies:

1. Fixed Window
2. Token Bucket
3. Concurrency Limiting

## Prerequisites

- Node.js
- Redis server running locally

## Installation

```bash
npm install
```

## Running the Example

```bash
npm start
```

## Testing the Rate Limits

You can test the different rate limiting strategies using curl or your browser:

### Fixed Window (5 requests per minute)
```bash
curl http://localhost:3000/fixed-window
```

### Token Bucket (10 tokens, refills 2 tokens per minute)
```bash
curl http://localhost:3000/token-bucket
```

### Concurrency (max 3 concurrent requests)
```bash
curl http://localhost:3000/concurrency
```

## Rate Limit Headers

The API returns the following rate limit headers:
- X-RateLimit-Limit: Maximum number of requests allowed
- X-RateLimit-Remaining: Number of requests remaining in the current window
- X-RateLimit-Reset: Time when the rate limit will reset (Unix timestamp)
