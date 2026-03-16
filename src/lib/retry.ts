/**
 * Exponential backoff retry wrapper for async functions.
 * Retries on transient failures with configurable attempts and delay.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 * Delay doubles on each attempt: baseDelay, 2×baseDelay, 4×baseDelay, ...
 * Adds ±25% jitter to prevent thundering herd.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) break;

      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = 0.75 + Math.random() * 0.5; // ±25%
      const delayMs = Math.min(exponentialDelay * jitter, maxDelayMs);

      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
