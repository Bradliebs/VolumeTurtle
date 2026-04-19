/**
 * Pre-flight checks — unit tests for all 12 checks + gap guardrails + clone safety.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

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

jest.mock("@/lib/currency", () => ({
  getGbpUsdRate: jest.fn().mockResolvedValue(1.27),
  getGbpEurRate: jest.fn().mockResolvedValue(1.17),
  getCurrencySymbol: jest.fn().mockReturnValue("$"),
  isUsdTicker: jest.fn((t: string) => !t.endsWith(".L") && !t.endsWith(".AS") && !t.endsWith(".HE")),
  isEurTicker: jest.fn((t: string) => t.endsWith(".AS") || t.endsWith(".HE")),
  convertToGbp: jest.fn((amount: number, ticker: string, gbpUsdRate: number) => {
    if (ticker.endsWith(".L")) return amount;
    return amount / gbpUsdRate;
  }),
}));

jest.mock("@/lib/signals/dataValidator", () => ({
  validateTicker: jest.fn().mockResolvedValue({ valid: true, flags: [], warnings: [] }),
}));

jest.mock("@/lib/signals/regimeFilter", () => ({
  calculateMarketRegime: jest.fn().mockResolvedValue({
    marketRegime: "BULLISH",
    volatilityRegime: "NORMAL",
  }),
  assessRegime: jest.fn().mockReturnValue({
    overallSignal: "STRONG",
    score: 3,
  }),
  calculateTickerRegime: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/lib/signals/breadthIndicator", () => ({
  calculateBreadth: jest.fn().mockResolvedValue({
    breadthSignal: "STRONG",
    above50MA: 70,
  }),
}));

jest.mock("@/lib/risk/equityCurve", () => ({
  calculateEquityCurveState: jest.fn().mockReturnValue({
    systemState: "NORMAL",
    drawdownPct: 0,
    riskMultiplier: 1.0,
    riskPctPerTrade: 2.0,
    maxPositions: 5,
  }),
}));

jest.mock("@/lib/universe/tickers", () => ({
  getUniverse: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/t212/client", () => ({
  loadT212Settings: jest.fn().mockReturnValue({
    apiKey: "test",
    apiSecret: "test",
    environment: "live",
  }),
  getAccountCash: jest.fn().mockResolvedValue({ cash: 5000 }),
  placeMarketOrder: jest.fn(),
  getInstruments: jest.fn(),
  yahooToT212Ticker: jest.fn(),
}));

jest.mock("@/lib/t212/pushStop", () => ({
  pushStopToT212: jest.fn(),
}));

jest.mock("@/lib/universe/ensureInCsv", () => ({
  ensureTickerInCsv: jest.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { preFlightChecks, type PendingOrderRow } from "@/lib/execution/autoExecutor";
import type { LiveQuote } from "@/lib/signals/dataValidator";
import { getAccountCash } from "@/lib/t212/client";
import { validateTicker } from "@/lib/signals/dataValidator";
import { calculateMarketRegime, assessRegime } from "@/lib/signals/regimeFilter";
import { calculateBreadth } from "@/lib/signals/breadthIndicator";
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
import { isUsdTicker, getGbpUsdRate } from "@/lib/currency";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<PendingOrderRow> = {}): PendingOrderRow {
  return {
    id: 1,
    ticker: "AAPL",
    sector: "Technology",
    signalSource: "volume",
    signalGrade: "A",
    compositeScore: 0.75,
    suggestedShares: 10,
    suggestedEntry: 150,
    suggestedStop: 140,
    dollarRisk: 100,
    status: "pending",
    cancelDeadline: new Date(Date.now() + 15 * 60_000),
    cancelledAt: null,
    cancelReason: null,
    executedAt: null,
    t212OrderId: null,
    actualShares: null,
    actualPrice: null,
    failureReason: null,
    isRunner: false,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeLiveQuote(overrides: Partial<LiveQuote & { marketState?: string }> = {}): LiveQuote {
  return {
    price: 150,
    volume: 1_000_000,
    ...overrides,
  } as LiveQuote;
}

// ── Mock DB ────────────────────────────────────────────────────────────────

// We need to mock the db proxy that autoExecutor creates internally.
// Since it casts prisma, we mock the prisma module directly.
const mockDb = {
  trade: {
    count: jest.fn().mockResolvedValue(2),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
  accountSnapshot: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue({ balance: 5000 }),
  },
  appSettings: {
    findFirst: jest.fn().mockResolvedValue({
      autoExecutionEnabled: true,
      autoExecutionMinGrade: "B",
      autoExecutionWindowMins: 15,
      autoExecutionMaxPerDay: 2,
      autoExecutionStartHour: 14,
      autoExecutionEndHour: 20,
      maxPositionsPerSector: 2,
      gapDownThreshold: 0.03,
      gapUpResizeThreshold: 0.05,
    }),
  },
  t212Connection: {
    findFirst: jest.fn().mockResolvedValue({
      environment: "live",
      apiKey: "test",
      connected: true,
    }),
  },
  pendingOrder: {
    count: jest.fn().mockResolvedValue(0),
  },
};

// Patch prisma module with our mock
jest.mock("@/db/client", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, prop) => {
        const db = require("./autoExecutor.test").__mockDb;
        return db?.[prop as string];
      },
    },
  ),
}));

// Export for proxy access
(module as unknown as { exports: { __mockDb: typeof mockDb } }).exports.__mockDb = mockDb;

// ── Tests ──────────────────────────────────────────────────────────────────

describe("preFlightChecks", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset all mocks to passing defaults
    (getAccountCash as jest.Mock).mockResolvedValue({ cash: 5000 });
    (validateTicker as jest.Mock).mockResolvedValue({ valid: true, flags: [], warnings: [] });
    (calculateMarketRegime as jest.Mock).mockResolvedValue({
      marketRegime: "BULLISH",
      volatilityRegime: "NORMAL",
    });
    (assessRegime as jest.Mock).mockReturnValue({
      overallSignal: "STRONG",
      score: 3,
    });
    (calculateBreadth as jest.Mock).mockResolvedValue({
      breadthSignal: "STRONG",
      above50MA: 70,
    });
    (calculateEquityCurveState as jest.Mock).mockReturnValue({
      systemState: "NORMAL",
      drawdownPct: 0,
      riskMultiplier: 1.0,
      riskPctPerTrade: 2.0,
      maxPositions: 5,
    });
    (isUsdTicker as jest.Mock).mockReturnValue(true);
    (getGbpUsdRate as jest.Mock).mockResolvedValue(1.27);

    mockDb.trade.count.mockResolvedValue(2);
    mockDb.trade.findFirst.mockResolvedValue(null);
    mockDb.accountSnapshot.findMany.mockResolvedValue([]);
    mockDb.accountSnapshot.findFirst.mockResolvedValue({ balance: 5000 });
    mockDb.t212Connection.findFirst.mockResolvedValue({
      environment: "live",
      apiKey: "test",
      connected: true,
    });
    mockDb.appSettings.findFirst.mockResolvedValue({
      maxPositionsPerSector: 2,
    });
  });

  // ── Check 1: CASH AVAILABLE ──

  it("Check 1: fails when insufficient cash", async () => {
    (getAccountCash as jest.Mock).mockResolvedValue({ cash: 10 }); // Only £10
    const order = makeOrder({ suggestedShares: 10, suggestedEntry: 150 }); // needs ~$1181
    const result = await preFlightChecks(order, makeLiveQuote());
    expect(result.failures.some((f) => f.includes("INSUFFICIENT_CASH"))).toBe(true);
  });

  it("Check 1: passes when sufficient cash", async () => {
    (getAccountCash as jest.Mock).mockResolvedValue({ cash: 5000 });
    const order = makeOrder({ suggestedShares: 2, suggestedEntry: 50 });
    const result = await preFlightChecks(order, makeLiveQuote({ price: 50 }));
    expect(result.failures.filter((f) => f.includes("CASH")).length).toBe(0);
  });

  // ── Check 2: PRICE VALIDATION ──

  it("Check 2: adjusts shares on 3% price drift", async () => {
    const order = makeOrder({ suggestedEntry: 100, suggestedStop: 90, dollarRisk: 100, suggestedShares: 10 });
    // Live price 104 → 4% drift → recalculate shares
    const result = await preFlightChecks(order, makeLiveQuote({ price: 104 }));
    expect(result.adjustments.some((a) => a.includes("PRICE_DRIFT"))).toBe(true);
    // Original order should NOT be mutated
    expect(order.suggestedShares).toBe(10);
    // Adjusted order should have new shares
    expect(result.adjustedOrder.suggestedShares).not.toBe(10);
  });

  it("Check 2: fails on >10% extreme price drift", async () => {
    const order = makeOrder({ suggestedEntry: 100, suggestedStop: 90 });
    const result = await preFlightChecks(order, makeLiveQuote({ price: 115 })); // 15% drift
    expect(result.failures.some((f) => f.includes("EXTREME_PRICE_DRIFT"))).toBe(true);
  });

  // ── Check 3: POSITION LIMIT ──

  it("Check 3: fails when at max positions", async () => {
    mockDb.trade.count.mockResolvedValue(5); // At max (config.maxPositions = 5)
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("MAX_POSITIONS"))).toBe(true);
  });

  it("Check 3: passes when below max positions", async () => {
    mockDb.trade.count.mockResolvedValue(3);
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.filter((f) => f.includes("MAX_POSITIONS")).length).toBe(0);
  });

  // ── Check 4: CIRCUIT BREAKER ──

  it("Check 4: blocks in PAUSE state", async () => {
    mockDb.accountSnapshot.findMany.mockResolvedValue([
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 7500 },
    ]);
    (calculateEquityCurveState as jest.Mock).mockReturnValue({
      systemState: "PAUSE",
      drawdownPct: 25,
      riskMultiplier: 0,
      riskPctPerTrade: 0,
      maxPositions: 0,
    });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("CIRCUIT_BREAKER_PAUSE"))).toBe(true);
  });

  it("Check 4: halves size in CAUTION state", async () => {
    mockDb.accountSnapshot.findMany.mockResolvedValue([
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 9000 },
    ]);
    (calculateEquityCurveState as jest.Mock).mockReturnValue({
      systemState: "CAUTION",
      drawdownPct: 10,
      riskMultiplier: 0.5,
      riskPctPerTrade: 1.0,
      maxPositions: 3,
    });
    const order = makeOrder({ suggestedShares: 10, suggestedEntry: 150, suggestedStop: 140, dollarRisk: 100 });
    const result = await preFlightChecks(order, makeLiveQuote());
    expect(result.adjustments.some((a) => a.includes("CIRCUIT_BREAKER_CAUTION"))).toBe(true);
    // Original not mutated
    expect(order.suggestedShares).toBe(10);
    // Adjusted order should have reduced shares
    expect(result.adjustedOrder.suggestedShares).toBeLessThan(10);
  });

  it("Check 4: full size in NORMAL state", async () => {
    mockDb.accountSnapshot.findMany.mockResolvedValue([
      { date: "2025-01-01", balance: 10000 },
    ]);
    (calculateEquityCurveState as jest.Mock).mockReturnValue({
      systemState: "NORMAL",
      drawdownPct: 0,
      riskMultiplier: 1.0,
      riskPctPerTrade: 2.0,
      maxPositions: 5,
    });
    const order = makeOrder({ suggestedShares: 10 });
    const result = await preFlightChecks(order, makeLiveQuote());
    expect(result.adjustments.filter((a) => a.includes("CIRCUIT_BREAKER")).length).toBe(0);
    expect(result.adjustedOrder.suggestedShares).toBe(10);
  });

  // ── Check 5: REGIME GATE ──

  it("Check 5: blocks Grade B in CAUTION regime", async () => {
    (assessRegime as jest.Mock).mockReturnValue({
      overallSignal: "CAUTION",
      score: 2,
    });
    const result = await preFlightChecks(
      makeOrder({ signalGrade: "B" }),
      makeLiveQuote(),
    );
    expect(result.failures.some((f) => f.includes("REGIME_CAUTION"))).toBe(true);
  });

  it("Check 5: blocks all in AVOID regime", async () => {
    (assessRegime as jest.Mock).mockReturnValue({
      overallSignal: "AVOID",
      score: 0,
    });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("REGIME_AVOID"))).toBe(true);
  });

  it("Check 5: blocks in DETERIORATING breadth", async () => {
    (calculateBreadth as jest.Mock).mockResolvedValue({
      breadthSignal: "DETERIORATING",
      above50MA: 30,
    });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("BREADTH_DETERIORATING"))).toBe(true);
  });

  // ── Check 6: DATA VALIDATION ──

  it("Check 6: fails on invalid ticker data", async () => {
    (validateTicker as jest.Mock).mockResolvedValue({
      valid: false,
      flags: ["EXTREME_MOVE", "POSSIBLE_SPLIT"],
      warnings: [],
    });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("DATA_VALIDATION"))).toBe(true);
  });

  it("Check 6: passes on valid ticker data", async () => {
    (validateTicker as jest.Mock).mockResolvedValue({
      valid: true,
      flags: [],
      warnings: [],
    });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.filter((f) => f.includes("DATA_VALIDATION")).length).toBe(0);
  });

  // ── Check 7: DUPLICATE CHECK ──

  it("Check 7: fails on duplicate ticker", async () => {
    mockDb.trade.findFirst.mockResolvedValue({ id: "abc", ticker: "AAPL", status: "OPEN" });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("DUPLICATE"))).toBe(true);
  });

  it("Check 7: passes on novel ticker", async () => {
    mockDb.trade.findFirst.mockResolvedValue(null);
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.filter((f) => f.includes("DUPLICATE")).length).toBe(0);
  });

  // ── Check 8: MARKET HOURS ──

  it("Check 8: queues when market closed", async () => {
    const quote = makeLiveQuote();
    (quote as unknown as Record<string, unknown>)["marketState"] = "CLOSED";
    const result = await preFlightChecks(makeOrder(), quote);
    expect(result.failures.some((f) => f.includes("MARKET_CLOSED"))).toBe(true);
  });

  it("Check 8: proceeds when market open", async () => {
    const quote = makeLiveQuote();
    (quote as unknown as Record<string, unknown>)["marketState"] = "REGULAR";
    const result = await preFlightChecks(makeOrder(), quote);
    expect(result.failures.filter((f) => f.includes("MARKET_CLOSED")).length).toBe(0);
  });

  // ── Check 11: MAX EXPOSURE CAP ──

  it("Check 11: caps shares at 25% exposure", async () => {
    // Balance 5000, order = 10 shares × $150 = $1500 → ~$1181 GBP → 23.6% — within limit with 5k balance
    // Need to exceed 25%: 20 shares × $150 = $3000 → ~$2362 → 47%
    mockDb.accountSnapshot.findFirst.mockResolvedValue({ balance: 2000 });
    const order = makeOrder({ suggestedShares: 20, suggestedEntry: 150 });
    const result = await preFlightChecks(order, makeLiveQuote());
    expect(result.adjustments.some((a) => a.includes("EXPOSURE_CAPPED"))).toBe(true);
    // Original not mutated
    expect(order.suggestedShares).toBe(20);
  });

  it("Check 11: never fails, only caps", async () => {
    // Even with massive exposure, it adjusts rather than failing
    mockDb.accountSnapshot.findFirst.mockResolvedValue({ balance: 1000 });
    const order = makeOrder({ suggestedShares: 100, suggestedEntry: 150 });
    const result = await preFlightChecks(order, makeLiveQuote());
    // Should have an adjustment, NOT a failure for exposure
    expect(result.failures.filter((f) => f.includes("EXPOSURE")).length).toBe(0);
  });

  // ── Check 12: SECTOR CONCENTRATION ──

  it("Check 12: blocks when sector at limit", async () => {
    mockDb.appSettings.findFirst.mockResolvedValue({ maxPositionsPerSector: 2 });
    // Mock: 2 open trades in Technology sector (at limit)
    mockDb.trade.count.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: { sector?: string } })?.where;
      if (where?.sector === "Technology") return 2;
      return 0;
    });
    const result = await preFlightChecks(
      makeOrder({ sector: "Technology" }),
      makeLiveQuote(),
    );
    expect(result.failures.some((f) => f.includes("SECTOR_CONCENTRATION"))).toBe(true);
  });

  it("Check 12: passes when sector has room", async () => {
    mockDb.appSettings.findFirst.mockResolvedValue({ maxPositionsPerSector: 2 });
    mockDb.trade.count.mockResolvedValue(1);
    const result = await preFlightChecks(
      makeOrder({ sector: "Technology" }),
      makeLiveQuote(),
    );
    expect(result.failures.filter((f) => f.includes("SECTOR_CONCENTRATION")).length).toBe(0);
  });

  // ── Gap guardrail tests (via preFlightChecks adjustments path) ──
  // Note: Gap guardrails are in processPendingOrder, not preFlightChecks.
  // We test the price-drift adjustment path which covers similar ground.

  it("Gap guardrail: price drift >10% simulates gap rejection scenario", async () => {
    // A 10%+ gap would trigger EXTREME_PRICE_DRIFT in Check 2
    const order = makeOrder({ suggestedEntry: 100, suggestedStop: 90 });
    const result = await preFlightChecks(order, makeLiveQuote({ price: 88 })); // -12% gap
    expect(result.failures.some((f) => f.includes("EXTREME_PRICE_DRIFT"))).toBe(true);
  });

  it("Gap guardrail: moderate gap up triggers resize adjustment", async () => {
    // Ensure sector has room so Check 12 doesn't fail
    mockDb.trade.count.mockResolvedValue(1);
    const order = makeOrder({ suggestedEntry: 100, suggestedStop: 90, dollarRisk: 100, suggestedShares: 10 });
    // +6% drift → recalculate but don't fail
    const result = await preFlightChecks(order, makeLiveQuote({ price: 106 }));
    expect(result.passed).toBe(true);
    expect(result.adjustments.some((a) => a.includes("PRICE_DRIFT"))).toBe(true);
  });

  // ── Clone safety ──

  it("mutations: input order not modified on failure", async () => {
    (assessRegime as jest.Mock).mockReturnValue({
      overallSignal: "AVOID",
      score: 0,
    });
    const order = makeOrder({ suggestedShares: 10, dollarRisk: 100 });
    const originalShares = order.suggestedShares;
    const originalRisk = order.dollarRisk;

    await preFlightChecks(order, makeLiveQuote());

    expect(order.suggestedShares).toBe(originalShares);
    expect(order.dollarRisk).toBe(originalRisk);
  });

  it("mutations: adjustedOrder reflects changes", async () => {
    // Trigger CAUTION equity curve → halved size
    mockDb.accountSnapshot.findMany.mockResolvedValue([
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 9000 },
    ]);
    (calculateEquityCurveState as jest.Mock).mockReturnValue({
      systemState: "CAUTION",
      drawdownPct: 10,
      riskMultiplier: 0.5,
      riskPctPerTrade: 1.0,
      maxPositions: 3,
    });

    const order = makeOrder({
      suggestedShares: 10,
      suggestedEntry: 150,
      suggestedStop: 140,
      dollarRisk: 100,
    });

    const result = await preFlightChecks(order, makeLiveQuote());

    // Input untouched
    expect(order.suggestedShares).toBe(10);
    expect(order.dollarRisk).toBe(100);

    // adjustedOrder has the mutations
    expect(result.adjustedOrder.suggestedShares).toBeLessThan(10);
    expect(result.adjustedOrder.dollarRisk).toBeLessThan(100);
  });

  // ── Check 9: MINIMUM ORDER SIZE ──

  it("Check 9: fails when order value below T212 minimum", async () => {
    // Tiny order: 0.01 shares × $1 = $0.01 → ~£0.008 < £1
    const order = makeOrder({ suggestedShares: 0.01, suggestedEntry: 1 });
    const result = await preFlightChecks(order, makeLiveQuote({ price: 1 }));
    expect(result.failures.some((f) => f.includes("ORDER_TOO_SMALL"))).toBe(true);
  });

  it("Check 9: passes when order value is adequate", async () => {
    const order = makeOrder({ suggestedShares: 10, suggestedEntry: 150 });
    const result = await preFlightChecks(order, makeLiveQuote());
    expect(result.failures.filter((f) => f.includes("ORDER_TOO_SMALL")).length).toBe(0);
  });

  // ── Check 10: T212 CONNECTION ──

  it("Check 10: fails when T212 not connected", async () => {
    mockDb.t212Connection.findFirst.mockResolvedValue({ environment: "live", connected: false });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("T212_NOT_CONNECTED"))).toBe(true);
  });

  it("Check 10: fails when T212 in demo mode", async () => {
    mockDb.t212Connection.findFirst.mockResolvedValue({ environment: "demo", connected: true });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("T212_DEMO_MODE"))).toBe(true);
  });

  it("Check 10: passes when T212 connected in live mode", async () => {
    mockDb.t212Connection.findFirst.mockResolvedValue({ environment: "live", connected: true });
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.filter((f) => f.includes("T212_NOT_CONNECTED") || f.includes("T212_DEMO_MODE")).length).toBe(0);
  });

  // ── Check 13: PORTFOLIO HEAT CAP ──

  it("Check 13: blocks when heat exceeds cap", async () => {
    // Set HEAT_CAP_PCT to 5%
    process.env["HEAT_CAP_PCT"] = "0.05";
    mockDb.accountSnapshot.findFirst.mockResolvedValue({ balance: 5000 });
    // Existing open trades with heavy risk: entryPrice=100, hardStop=80, shares=20 → risk=400 per trade
    mockDb.trade.findMany.mockResolvedValue([
      { ticker: "AAPL", entryPrice: 100, hardStop: 80, shares: 20 },
    ]);
    // New order: entry=150, stop=140, shares=10 → risk=100
    // Total risk GBP: (400+100)/1.27 = ~394 GBP, which is 394/5000 = 7.9% > 5%
    const order = makeOrder({ suggestedEntry: 150, suggestedStop: 140, suggestedShares: 10 });
    const result = await preFlightChecks(order, makeLiveQuote());
    expect(result.failures.some((f) => f.includes("HEAT_CAP_EXCEEDED"))).toBe(true);
    delete process.env["HEAT_CAP_PCT"];
  });

  it("Check 13: passes when heat is within cap", async () => {
    process.env["HEAT_CAP_PCT"] = "0.20";
    mockDb.accountSnapshot.findFirst.mockResolvedValue({ balance: 50000 });
    mockDb.trade.findMany.mockResolvedValue([]);
    const order = makeOrder({ suggestedEntry: 150, suggestedStop: 140, suggestedShares: 2 });
    const result = await preFlightChecks(order, makeLiveQuote());
    expect(result.failures.filter((f) => f.includes("HEAT_CAP")).length).toBe(0);
    delete process.env["HEAT_CAP_PCT"];
  });

  it("Check 13: fails safe when balance fetch returns null", async () => {
    process.env["HEAT_CAP_PCT"] = "0.05";
    mockDb.accountSnapshot.findFirst.mockResolvedValue(null);
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("HEAT_CAP_FAILED"))).toBe(true);
    delete process.env["HEAT_CAP_PCT"];
  });

  it("Check 13: fails safe when balance fetch throws", async () => {
    process.env["HEAT_CAP_PCT"] = "0.05";
    mockDb.accountSnapshot.findFirst.mockRejectedValue(new Error("DB connection failed"));
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("HEAT_CAP_FAILED"))).toBe(true);
    delete process.env["HEAT_CAP_PCT"];
  });

  // ── Check 5: Grade A CAUTION regime sizing ──

  it("Check 5: Grade A in CAUTION regime gets 50% size reduction", async () => {
    (assessRegime as jest.Mock).mockReturnValue({
      overallSignal: "CAUTION",
      score: 2,
    });
    const order = makeOrder({ signalGrade: "A", suggestedShares: 10, suggestedEntry: 150, suggestedStop: 140, dollarRisk: 100 });
    const result = await preFlightChecks(order, makeLiveQuote());
    // Grade A should pass (not fail) but with adjustment
    expect(result.failures.filter((f) => f.includes("REGIME_CAUTION")).length).toBe(0);
    expect(result.adjustments.some((a) => a.includes("REGIME_CAUTION"))).toBe(true);
    // Shares should be halved
    expect(result.adjustedOrder.suggestedShares).toBeCloseTo(5, 1);
  });

  // ── Check 5: Breadth failure blocks order ──

  it("Check 5: breadth calculation failure blocks order", async () => {
    (calculateBreadth as jest.Mock).mockRejectedValue(new Error("API timeout"));
    const result = await preFlightChecks(makeOrder(), makeLiveQuote());
    expect(result.failures.some((f) => f.includes("BREADTH_UNAVAILABLE"))).toBe(true);
  });
});
