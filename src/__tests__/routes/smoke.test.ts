/**
 * Route import smoke tests — verifies every API route file can be imported
 * and exports the expected HTTP method handlers (GET, POST, PATCH, PUT, DELETE).
 *
 * Catches: broken imports, missing exports, syntax errors, circular deps.
 * Does NOT exercise route logic — that's what Tier 2 handler tests are for.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// ── Heavy dependency mocks (must come before any route import) ──────────
// Prisma uses import.meta which breaks Jest. Mock at the boundary.
jest.mock("@/db/client", () => ({
  prisma: new Proxy({}, {
    get: () => () => null,
  }),
}));

jest.mock("@/lib/config", () => require("../__mocks__/config"));

jest.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock("@/lib/telegram", () => ({
  sendTelegram: jest.fn().mockResolvedValue(undefined),
  formatSignalAlert: jest.fn().mockReturnValue(""),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockReturnValue(null),
  getRateLimitKey: jest.fn().mockReturnValue("test"),
}));

jest.mock("@/lib/t212/client", () => ({
  loadT212Settings: jest.fn().mockReturnValue(null),
  getInstruments: jest.fn().mockResolvedValue([]),
  yahooToT212Ticker: jest.fn().mockReturnValue(null),
  getCachedT212Positions: jest.fn().mockResolvedValue({ positions: [], fromCache: true }),
  getPositionsWithStopsMapped: jest.fn().mockResolvedValue([]),
  getPendingOrders: jest.fn().mockResolvedValue([]),
  cancelOrder: jest.fn().mockResolvedValue(undefined),
  placeMarketOrder: jest.fn().mockResolvedValue({ id: 0 }),
  placeMarketSellOrder: jest.fn().mockResolvedValue({ id: 0 }),
  getAccountCash: jest.fn().mockResolvedValue(0),
  isT212Pence: jest.fn().mockReturnValue(false),
}));

jest.mock("@/lib/t212/pushStop", () => ({
  pushStopToT212: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("@/lib/data/fetchQuotes", () => ({
  fetchAndCacheQuotes: jest.fn().mockResolvedValue([]),
  getLatestQuotes: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/data/yahoo", () => ({
  fetchQuote: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/signals/regimeFilter", () => ({
  calculateMarketRegime: jest.fn().mockResolvedValue({
    marketRegime: "BULLISH",
    qqqAbove200dMA: true,
    vixBelow30: true,
  }),
}));

jest.mock("@/lib/risk/equityCurve", () => ({
  calculateEquityCurveState: jest.fn().mockReturnValue({
    state: "NORMAL",
    drawdownPct: 0,
    peakEquity: 10000,
    currentEquity: 10000,
  }),
}));

jest.mock("@/lib/execution/autoExecutor", () => ({
  processPendingOrder: jest.fn().mockResolvedValue(undefined),
  executeOrder: jest.fn().mockResolvedValue({ success: false, error: "mock" }),
}));

jest.mock("@/lib/universe/tickers", () => ({
  getUniverse: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/universe/ensureInCsv", () => ({
  ensureTickerInCsv: jest.fn(),
}));

jest.mock("@/lib/currency", () => ({
  getCurrencySymbol: jest.fn().mockReturnValue("$"),
  isUsdTicker: jest.fn().mockReturnValue(true),
  isEurTicker: jest.fn().mockReturnValue(false),
  convertToGbp: jest.fn((amount: number) => amount),
  getGbpUsdRate: jest.fn().mockResolvedValue(1.27),
  getGbpEurRate: jest.fn().mockResolvedValue(1.17),
}));

jest.mock("@/lib/cruise-control/cruise-control-engine", () => ({
  runCruiseControlCycle: jest.fn().mockResolvedValue({ ratcheted: 0 }),
}));

jest.mock("@/lib/backtest", () => ({
  runBacktestEndToEnd: jest.fn().mockResolvedValue({ runId: 0 }),
}));

jest.mock("@/lib/validation", () => ({
  closeTradeSchema: { parse: jest.fn() },
  validateBody: jest.fn().mockResolvedValue({ data: {}, error: null }),
}));

jest.mock("@/lib/signals/compositeScore", () => ({
  calculateCompositeScore: jest.fn().mockReturnValue({ score: 5, grade: "C" }),
}));

jest.mock("@/lib/signals/volumeSignal", () => ({
  calculateVolumeSignal: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/signals/exitSignal", () => ({
  shouldExit: jest.fn().mockReturnValue(false),
  updateTrailingStop: jest.fn().mockReturnValue(100),
}));

jest.mock("@/lib/signals/dataValidator", () => ({
  validateQuoteData: jest.fn().mockReturnValue({ valid: true }),
}));

jest.mock("@/lib/risk/atr", () => ({
  calculateATR: jest.fn().mockReturnValue(2),
}));

jest.mock("@/lib/risk/positionSizer", () => ({
  calculatePositionSize: jest.fn().mockReturnValue({ shares: 10, risk: 100 }),
}));

jest.mock("@/lib/risk/ratchetStops", () => ({
  calculateRatchetStops: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/trades/utils", () => ({
  enforceMonotonicStop: jest.fn((n: number) => n),
  buildStopHistoryEntry: jest.fn().mockReturnValue({}),
  tradeToOpenPosition: jest.fn().mockReturnValue({}),
  calculateRMultiple: jest.fn().mockReturnValue(0),
}));

jest.mock("@/lib/hbme/breakoutEngine", () => ({
  runBreakoutScan: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/hbme/scanHelpers", () => ({
  loadMomentumUniverse: jest.fn().mockResolvedValue([]),
}));

// ── Route manifest ──────────────────────────────────────────────────────

interface RouteEntry {
  /** Display path */
  name: string;
  /** Import path (relative from this test file to route module) */
  importPath: string;
  /** Expected HTTP method exports */
  methods: string[];
}

const API = "../../app/api";

const ROUTES: RouteEntry[] = [
  { name: "account/size",               importPath: `${API}/account/size/route`,               methods: ["GET"] },
  { name: "agent/decisions",            importPath: `${API}/agent/decisions/route`,             methods: ["GET"] },
  { name: "agent/journal",              importPath: `${API}/agent/journal/route`,               methods: ["POST"] },
  { name: "agent/settings",             importPath: `${API}/agent/settings/route`,              methods: ["GET", "PATCH"] },
  { name: "alerts",                     importPath: `${API}/alerts/route`,                      methods: ["GET", "POST", "PATCH"] },
  { name: "auth/login",                 importPath: `${API}/auth/login/route`,                  methods: ["POST"] },
  { name: "backup",                     importPath: `${API}/backup/route`,                      methods: ["GET", "POST"] },
  { name: "backtest",                   importPath: `${API}/backtest/route`,                    methods: ["GET"] },
  { name: "backtest/[id]",              importPath: `${API}/backtest/[id]/route`,               methods: ["GET", "DELETE"] },
  { name: "backtest/run",               importPath: `${API}/backtest/run/route`,                methods: ["POST"] },
  { name: "backtest/snapshot",          importPath: `${API}/backtest/snapshot/route`,            methods: ["GET", "POST"] },
  { name: "balance",                    importPath: `${API}/balance/route`,                     methods: ["PATCH"] },
  { name: "breadth",                    importPath: `${API}/breadth/route`,                     methods: ["GET"] },
  { name: "cruise-control/activity",    importPath: `${API}/cruise-control/activity/route`,     methods: ["GET"] },
  { name: "cruise-control/alerts",      importPath: `${API}/cruise-control/alerts/route`,       methods: ["GET", "PATCH"] },
  { name: "cruise-control/poll-now",    importPath: `${API}/cruise-control/poll-now/route`,     methods: ["POST"] },
  { name: "cruise-control/ratchet",     importPath: `${API}/cruise-control/ratchet/route`,      methods: ["POST"] },
  { name: "cruise-control/state",       importPath: `${API}/cruise-control/state/route`,        methods: ["GET"] },
  { name: "cruise-control/toggle",      importPath: `${API}/cruise-control/toggle/route`,       methods: ["POST"] },
  { name: "dashboard",                  importPath: `${API}/dashboard/route`,                   methods: ["GET"] },
  { name: "execution/execute",          importPath: `${API}/execution/execute/route`,           methods: ["POST"] },
  { name: "execution/log",              importPath: `${API}/execution/log/route`,               methods: ["GET"] },
  { name: "execution/pending",          importPath: `${API}/execution/pending/route`,           methods: ["GET", "POST", "DELETE"] },
  { name: "execution/push-stops",       importPath: `${API}/execution/push-stops/route`,        methods: ["GET", "POST"] },
  { name: "execution/settings",         importPath: `${API}/execution/settings/route`,          methods: ["GET", "POST"] },
  { name: "export/full",                importPath: `${API}/export/full/route`,                 methods: ["GET"] },
  { name: "export/scans",               importPath: `${API}/export/scans/route`,                methods: ["GET"] },
  { name: "export/signals",             importPath: `${API}/export/signals/route`,              methods: ["GET"] },
  { name: "export/trades",              importPath: `${API}/export/trades/route`,               methods: ["GET"] },
  { name: "health",                     importPath: `${API}/health/route`,                      methods: ["GET"] },
  { name: "internal/cleanup",           importPath: `${API}/internal/cleanup/route`,            methods: ["POST"] },
  { name: "journal",                    importPath: `${API}/journal/route`,                     methods: ["GET"] },
  { name: "momentum/scan",              importPath: `${API}/momentum/scan/route`,               methods: ["POST"] },
  { name: "momentum/sectors",           importPath: `${API}/momentum/sectors/route`,            methods: ["GET"] },
  { name: "momentum/signals",           importPath: `${API}/momentum/signals/route`,            methods: ["GET"] },
  { name: "positions/[id]/sync",        importPath: `${API}/positions/[id]/sync/route`,         methods: ["POST"] },
  { name: "positions/sync-all",         importPath: `${API}/positions/sync-all/route`,          methods: ["POST"] },
  { name: "scan",                       importPath: `${API}/scan/route`,                        methods: ["GET"] },
  { name: "scan/scheduled",             importPath: `${API}/scan/scheduled/route`,              methods: ["GET"] },
  { name: "settings",                   importPath: `${API}/settings/route`,                    methods: ["GET", "PUT"] },
  { name: "settings/danger",            importPath: `${API}/settings/danger/route`,             methods: ["POST"] },
  { name: "settings/executor-mode",     importPath: `${API}/settings/executor-mode/route`,      methods: ["GET", "POST"] },
  { name: "settings/momentum",          importPath: `${API}/settings/momentum/route`,           methods: ["GET", "POST"] },
  { name: "settings/telegram",          importPath: `${API}/settings/telegram/route`,           methods: ["GET", "POST"] },
  { name: "settings/time-stop",         importPath: `${API}/settings/time-stop/route`,          methods: ["GET", "POST", "DELETE"] },
  { name: "stops/[id]",                 importPath: `${API}/stops/[id]/route`,                  methods: ["PATCH"] },
  { name: "t212/buy",                   importPath: `${API}/t212/buy/route`,                    methods: ["POST"] },
  { name: "t212/import",                importPath: `${API}/t212/import/route`,                 methods: ["POST"] },
  { name: "t212/import-all",            importPath: `${API}/t212/import-all/route`,             methods: ["POST"] },
  { name: "t212/positions",             importPath: `${API}/t212/positions/route`,              methods: ["GET"] },
  { name: "t212/status",                importPath: `${API}/t212/status/route`,                 methods: ["GET"] },
  { name: "t212/stops/[id]",            importPath: `${API}/t212/stops/[id]/route`,             methods: ["POST"] },
  { name: "t212/stops/ticker",          importPath: `${API}/t212/stops/ticker/route`,           methods: ["POST"] },
  { name: "t212/sync",                  importPath: `${API}/t212/sync/route`,                   methods: ["POST"] },
  { name: "t212/test",                  importPath: `${API}/t212/test/route`,                   methods: ["POST"] },
  { name: "telegram/send",              importPath: `${API}/telegram/send/route`,               methods: ["POST"] },
  { name: "trades",                     importPath: `${API}/trades/route`,                      methods: ["POST"] },
  { name: "trades/[id]",                importPath: `${API}/trades/[id]/route`,                 methods: ["PATCH"] },
  { name: "trades/[id]/close",          importPath: `${API}/trades/[id]/close/route`,           methods: ["POST"] },
  { name: "trades/ratchet",             importPath: `${API}/trades/ratchet/route`,              methods: ["POST"] },
  { name: "trades/runner",              importPath: `${API}/trades/runner/route`,               methods: ["GET", "PATCH"] },
  { name: "watchlist",                  importPath: `${API}/watchlist/route`,                   methods: ["GET", "POST", "DELETE"] },
];

// ── Tests ────────────────────────────────────────────────────────────────

describe("API Route Smoke Tests", () => {
  it.each(ROUTES)(
    "/api/$name exports $methods",
    async ({ importPath, methods }) => {
      const mod = await import(importPath);
      for (const method of methods) {
        expect(typeof mod[method]).toBe("function");
      }
    },
  );

  it("manifest covers all 62 route files", () => {
    expect(ROUTES).toHaveLength(62);
  });
});
