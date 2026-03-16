import { withRetry } from "@/lib/retry";

describe("withRetry", () => {
  it("returns immediately on first success", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure then succeeds", async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry callback with attempt info", async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, expect.any(Number));
  });

  it("respects maxDelayMs cap", async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 100000,
      maxDelayMs: 50,
      onRetry,
    });

    // Both retry delays should be capped at 50ms
    for (const call of onRetry.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(50);
    }
  });

  it("defaults to 3 attempts", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, { baseDelayMs: 10 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
