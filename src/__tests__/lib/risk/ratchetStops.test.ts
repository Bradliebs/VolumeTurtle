/**
 * ratchetStops — unit tests for stop ratchet guards.
 * Tests the zero-stop and insufficient-candle guards.
 */

jest.mock("@/lib/config", () => require("../../__mocks__/config"));

jest.mock("@/db/client", () => ({
  prisma: {},
}));

jest.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock("@/lib/telegram", () => ({
  sendTelegram: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/data/quoteCache", () => ({
  getCachedQuotes: jest.fn(),
}));

jest.mock("@/lib/risk/trailingStop", () => ({
  evaluateTrailingStop: jest.fn(),
}));

jest.mock("@/lib/t212/client", () => ({
  loadT212Settings: jest.fn().mockReturnValue(null),
  updateStopOnT212: jest.fn(),
  getCachedT212Positions: jest.fn().mockResolvedValue({ positions: [] }),
}));

import { ratchetAllStops } from "@/lib/risk/ratchetStops";
import { getCachedQuotes } from "@/lib/data/quoteCache";

// Mock the db proxy
const mockDb = {
  trade: {
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  alert: {
    create: jest.fn().mockResolvedValue({}),
  },
  appSettings: {
    findFirst: jest.fn().mockResolvedValue({
      runnerProfitThreshold: 0.30,
      runnerLookbackDays: 20,
    }),
  },
};

jest.mock("@/db/client", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, prop) => {
        const db = require("./ratchetStops.test").__mockDb;
        return db?.[prop as string];
      },
    },
  ),
}));

(module as unknown as { exports: { __mockDb: typeof mockDb } }).exports.__mockDb = mockDb;

describe("ratchetAllStops", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trade.findMany.mockResolvedValue([]);
    mockDb.appSettings.findFirst.mockResolvedValue({
      runnerProfitThreshold: 0.30,
      runnerLookbackDays: 20,
    });
  });

  it("skips position when candle count is below 5", async () => {
    mockDb.trade.findMany.mockResolvedValue([
      {
        id: "trade-1",
        ticker: "AAPL",
        entryPrice: 100,
        shares: 10,
        hardStop: 90,
        trailingStop: 92,
        hardStopPrice: 90,
        trailingStopPrice: 92,
        peakClosePrice: null,
        stopSource: null,
        isRunner: false,
        runnerActivatedAt: null,
        runnerPeakProfit: null,
      },
    ]);

    // Return only 3 candles — below the 5-candle minimum
    (getCachedQuotes as jest.Mock).mockResolvedValue([
      { date: "2025-01-01", close: 100, high: 102, low: 98, open: 99, volume: 1000 },
      { date: "2025-01-02", close: 101, high: 103, low: 99, open: 100, volume: 1000 },
      { date: "2025-01-03", close: 102, high: 104, low: 100, open: 101, volume: 1000 },
    ]);

    const result = await ratchetAllStops(false);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.ratcheted).toBe(0);
    expect(result.results[0]!.error).toContain("candles");
    // Stop should NOT have been changed — still at original value
    expect(result.results[0]!.newStop).toBe(92);
    expect(result.results[0]!.ratcheted).toBe(false);
  });

  it("returns empty result when no open trades", async () => {
    mockDb.trade.findMany.mockResolvedValue([]);

    const result = await ratchetAllStops(false);

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.ratcheted).toBe(0);
    expect(result.results).toEqual([]);
  });
});
