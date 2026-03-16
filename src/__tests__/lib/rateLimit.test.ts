import { rateLimit } from "@/lib/rateLimit";

describe("rateLimit", () => {
  afterEach(() => {
    // Reset by using unique keys per test
  });

  it("allows requests under the limit", () => {
    const key = "test-allow-" + Date.now();
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 60_000)).toBeNull();
    }
  });

  it("blocks requests over the limit", () => {
    const key = "test-block-" + Date.now();
    // Use up all 3 allowed
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000)).toBeNull();
    }
    // 4th should be blocked
    const result = rateLimit(key, 3, 60_000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("resets after the window expires", async () => {
    const key = "test-reset-" + Date.now();
    // Fill up the limit with a 100ms window
    for (let i = 0; i < 2; i++) {
      rateLimit(key, 2, 100);
    }
    expect(rateLimit(key, 2, 100)).not.toBeNull(); // blocked

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 150));
    expect(rateLimit(key, 2, 100)).toBeNull(); // allowed again
  });

  it("uses independent buckets for different keys", () => {
    const key1 = "test-key1-" + Date.now();
    const key2 = "test-key2-" + Date.now();

    for (let i = 0; i < 3; i++) {
      rateLimit(key1, 3, 60_000);
    }
    expect(rateLimit(key1, 3, 60_000)).not.toBeNull(); // key1 blocked

    // key2 should still be fine
    expect(rateLimit(key2, 3, 60_000)).toBeNull();
  });
});
