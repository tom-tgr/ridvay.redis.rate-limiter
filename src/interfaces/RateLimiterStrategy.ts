export interface RateLimiterOptions {
    identifier: string;
}

export interface RateLimiterResult {
    success: boolean;
    remaining: number;
    reset: number;
    limit: number;
    name: string;
    metadata?: any;
}

export interface RateLimiterStrategy {
    isAllowed(identifier: string): Promise<RateLimiterResult>;
    reset(identifier: string): Promise<void>;
}