/**
 * Trading 212 API client — read-only Phase 1.
 * All credentials are stored in environment variables.
 */

export interface T212Settings {
  environment: "demo" | "live";
  apiKey: string;
  apiSecret: string;
  accountType: "invest" | "isa" | "both";
}

const T212_ENDPOINTS = {
  demo: "https://demo.trading212.com/api/v0",
  live: "https://live.trading212.com/api/v0",
};

export async function t212Fetch(path: string, settings: T212Settings): Promise<unknown> {
  const baseUrl = T212_ENDPOINTS[settings.environment];
  const credentials = Buffer.from(`${settings.apiKey}:${settings.apiSecret}`).toString("base64");

  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`T212 API error: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`);
  }

  return response.json();
}

// ── Read-only endpoints ──

export interface T212AccountSummary {
  cash: number;
  total: number;
  ppl: number; // profit/loss
  open: number;
  id?: string;
  currencyCode?: string;
}

export async function getAccountCash(settings: T212Settings): Promise<T212AccountSummary> {
  return t212Fetch("/equity/account/cash", settings) as Promise<T212AccountSummary>;
}

export interface T212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number; // profit/loss
  fxPpl?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

export async function getOpenPositions(settings: T212Settings): Promise<T212Position[]> {
  return t212Fetch("/equity/portfolio", settings) as Promise<T212Position[]>;
}

export interface T212Order {
  id: number;
  ticker: string;
  type: string;
  status: string;
  stopPrice?: number;
  limitPrice?: number;
  quantity: number;
  filledQuantity: number;
}

export async function getPendingOrders(settings: T212Settings): Promise<T212Order[]> {
  return t212Fetch("/equity/orders", settings) as Promise<T212Order[]>;
}

/**
 * Fetch positions enriched with stop-loss data.
 * T212 may return stopLoss directly on the position object,
 * or it may be in pending orders — we check both.
 */
export async function getPositionsWithStops(settings: T212Settings): Promise<T212Position[]> {
  const [positions, orders] = await Promise.all([
    getOpenPositions(settings),
    getPendingOrders(settings).catch(() => [] as T212Order[]),
  ]);

  for (const pos of positions) {
    // If stopLoss isn't already on the position, check pending orders
    if (pos.stopLoss == null) {
      const stopOrder = orders.find(
        (o) => o.ticker === pos.ticker && (o.type === "STOP" || o.type === "STOP_LIMIT"),
      );
      if (stopOrder?.stopPrice) {
        pos.stopLoss = stopOrder.stopPrice;
      }
    }
  }

  return positions;
}

export interface T212Instrument {
  ticker: string;
  shortName: string;
  name: string;
  currencyCode: string;
  type: string;
  isin: string;
}

/**
 * Fetch all T212 instrument metadata.
 * Used to map T212 internal tickers (e.g. "PMOl_EQ") to Yahoo tickers (e.g. "HBR.L").
 */
export async function getInstruments(settings: T212Settings): Promise<T212Instrument[]> {
  return t212Fetch("/equity/metadata/instruments", settings) as Promise<T212Instrument[]>;
}

// Cache instruments to avoid repeated API calls (promise-based to prevent races)
let instrumentCachePromise: Promise<T212Instrument[]> | null = null;

/**
 * Map a T212 internal ticker to a Yahoo-style ticker.
 * E.g. "PMOl_EQ" (shortName "HBR", currencyCode "GBX") -> "HBR.L"
 */
function t212ToYahooTicker(t212Ticker: string, instruments: T212Instrument[]): string {
  const inst = instruments.find((i) => i.ticker === t212Ticker);
  if (!inst) return t212Ticker;

  const short = inst.shortName;

  // LSE stocks (GBX = pence)
  if (inst.currencyCode === "GBX" || inst.currencyCode === "GBP") {
    return `${short}.L`;
  }
  // Amsterdam
  if (inst.currencyCode === "EUR" && t212Ticker.endsWith("l_EQ")) {
    return `${short}.AS`;
  }
  // US stocks
  if (inst.currencyCode === "USD") {
    return short;
  }

  return short;
}

/**
 * Check if a T212 instrument is quoted in pence (GBX).
 */
function isT212Pence(t212Ticker: string, instruments: T212Instrument[]): boolean {
  const inst = instruments.find((i) => i.ticker === t212Ticker);
  return inst?.currencyCode === "GBX";
}

/**
 * Fetch positions with stops and map to Yahoo-style tickers.
 * Converts GBX (pence) prices to GBP (pounds).
 */
export async function getPositionsWithStopsMapped(settings: T212Settings): Promise<T212Position[]> {
  // Load instruments (cached, race-safe)
  if (!instrumentCachePromise) {
    instrumentCachePromise = getInstruments(settings);
  }
  const instrumentCache = await instrumentCachePromise;

  const [rawPositions, orders] = await Promise.all([
    getOpenPositions(settings),
    getPendingOrders(settings).catch(() => [] as T212Order[]),
  ]);

  // Return new objects instead of mutating originals
  const positions: T212Position[] = rawPositions.map((original) => {
    const pos = { ...original };
    const pence = isT212Pence(pos.ticker, instrumentCache);
    const divisor = pence ? 100 : 1;

    // Map ticker
    const originalT212Ticker = pos.ticker;
    pos.ticker = t212ToYahooTicker(originalT212Ticker, instrumentCache);

    // Convert pence to pounds
    if (pence) {
      pos.averagePrice = pos.averagePrice / divisor;
      pos.currentPrice = pos.currentPrice / divisor;
      pos.ppl = pos.ppl / divisor;
    }

    // Match stop-loss from pending orders
    if (pos.stopLoss == null) {
      for (const o of orders) {
        const orderYahoo = t212ToYahooTicker(o.ticker, instrumentCache);
        if (orderYahoo === pos.ticker && (o.type === "STOP" || o.type === "STOP_LIMIT")) {
          pos.stopLoss = o.stopPrice != null ? o.stopPrice / divisor : null;
          break;
        }
      }
    } else if (pence && pos.stopLoss != null) {
      pos.stopLoss = pos.stopLoss / divisor;
    }

    return pos;
  });

  return positions;
}

export async function testConnection(settings: T212Settings): Promise<{
  success: boolean;
  currency?: string;
  cash?: number;
  accountId?: string;
  error?: string;
}> {
  try {
    const summary = await getAccountCash(settings);
    return {
      success: true,
      currency: summary.currencyCode ?? "GBP",
      cash: summary.cash,
      accountId: summary.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Load T212 settings from environment variables.
 * Returns null if not configured.
 */
export function loadT212Settings(): T212Settings | null {
  const apiKey = process.env["T212_API_KEY"];
  const env = (process.env["T212_ENVIRONMENT"] ?? "demo") as "demo" | "live";
  const apiSecret = process.env["T212_API_SECRET"] ?? "";
  const accountType = (process.env["T212_ACCOUNT_TYPE"] ?? "isa") as "invest" | "isa" | "both";

  if (!apiKey) return null;

  return {
    environment: env,
    apiKey,
    apiSecret,
    accountType,
  };
}
