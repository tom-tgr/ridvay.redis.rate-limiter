export interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: any): Promise<'OK' | null>;
    del(key: string): Promise<number>;
    eval(script: string, keys: number, ...args: any[]): Promise<any>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
}