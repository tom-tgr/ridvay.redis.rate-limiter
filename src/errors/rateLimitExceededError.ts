export class RateLimitExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitExceededError';
    }
}