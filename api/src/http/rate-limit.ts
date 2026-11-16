import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";

/**
 * Counts events per key over a sliding window, in memory. Enough for one API process; a
 * deployment with several processes would keep these counts in a shared store.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly nowMs: () => number = Date.now,
  ) {}

  /**
   * Records one event for `key`. Returns 0 when it is allowed, otherwise the number of seconds
   * until the oldest counted event leaves the window (the event is then not recorded).
   */
  take(key: string): number {
    const now = this.nowMs();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }
}

/** Sets Retry-After and builds the 429 the spec describes. */
export function tooManyRequests(res: Response, retryAfterSeconds: number, what: string): ApiError {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  return new ApiError(429, "rate_limited", `Too many ${what}. Try again shortly.`, {
    retryAfterSeconds,
  });
}

/** Express middleware: at most `limiter`'s limit of requests per key. Mount after auth. */
export function rateLimit(limiter: RateLimiter, keyOf: (res: Response) => string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const wait = limiter.take(keyOf(res));
    next(wait > 0 ? tooManyRequests(res, wait, "requests") : undefined);
  };
}
