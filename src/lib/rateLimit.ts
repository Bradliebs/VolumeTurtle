import { NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean stale entries periodically — HMR-safe via globalThis guard
const gRL = globalThis as unknown as { __rateLimitCleanup?: ReturnType<typeof setInterval> };
if (!gRL.__rateLimitCleanup) {
  gRL.__rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60_000);
  gRL.__rateLimitCleanup.unref();
}

/**
 * In-memory rate limiter for API routes.
 * Returns null if allowed, or a NextResponse with 429 if rate limited.
 *
 * @param key - Identifier for the rate limit bucket (e.g. IP + path)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 */
export function rateLimit(
  key: string,
  maxRequests: number = 30,
  windowMs: number = 60_000,
): NextResponse | null {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      },
    );
  }

  return null;
}

/**
 * Get a rate limit key from a request (IP + pathname).
 */
export function getRateLimitKey(request: Request): string {
  const url = new URL(request.url);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return `${ip}:${url.pathname}`;
}
