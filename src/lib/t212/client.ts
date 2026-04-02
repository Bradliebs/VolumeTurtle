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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function t212Fetch(path: string, settings: T212Settings, options?: { method?: string; body?: unknown }): Promise<unknown> {
  const baseUrl = T212_ENDPOINTS[settings.environment];
  const credentials = Buffer.from(`${settings.apiKey}:${settings.apiSecret}`).toString("base64");

  const method = options?.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: `Basic ${credentials}`,
  };
  let body: string | undefined;
  if (options?.body != null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  // Retry up to 3 times on 429 (rate limit), respecting reset header
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body });

    if (response.status === 429) {
      const resetHeader = response.headers.get("x-ratelimit-reset");
      let waitMs = 3000 * (attempt + 1); // default: 3s, 6s, 9s
      if (resetHeader) {
        const resetTime = parseInt(resetHeader, 10) * 1000;
        const now = Date.now();
        if (resetTime > now) waitMs = Math.min(resetTime - now + 500, 30_000);
      }
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new Error(`T212 API error: ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody}` : ""}`);
    }

    // DELETE returns empty body (204)
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return null;
    }

    return response.json();
  }

  throw new Error(`T212 API rate limited after 3 retries: ${method} ${path}`);
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
  stopLossPrice?: number;
  triggerPrice?: number;
  limitPrice?: number;
  stopLoss?: number;
  price?: number;
  quantity: number;
  filledQuantity: number;
}

export async function getPendingOrders(settings: T212Settings): Promise<T212Order[]> {
  return t212Fetch("/equity/orders", settings) as Promise<T212Order[]>;
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function isStopOrderType(type: string | undefined): boolean {
  if (!type) return false;
  return type.toUpperCase().includes("STOP");
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractOrderStopPrice(order: T212Order): number | null {
  return (
    asNumber(order.stopPrice) ??
    asNumber(order.stopLossPrice) ??
    asNumber(order.triggerPrice) ??
    asNumber(order.stopLoss) ??
    asNumber(order.limitPrice) ??
    asNumber(order.price)
  );
}

function extractPositionStopLoss(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  return (
    asNumber(rec["stopLoss"]) ??
    asNumber(rec["stopLossPrice"]) ??
    asNumber(rec["stop_price"])
  );
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
    const normalizedPosTicker = normalizeTicker(pos.ticker);
    if (pos.stopLoss == null) {
      pos.stopLoss = extractPositionStopLoss(pos);
    }
    // If stopLoss isn't already on the position, check pending orders
    if (pos.stopLoss == null) {
      const stopOrder = orders.find(
        (o) => normalizeTicker(o.ticker) === normalizedPosTicker && isStopOrderType(o.type),
      );
      const stopPrice = stopOrder ? extractOrderStopPrice(stopOrder) : null;
      if (stopPrice != null) {
        pos.stopLoss = stopPrice;
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
      pos.stopLoss = extractPositionStopLoss(original);
    }
    if (pos.stopLoss == null) {
      for (const o of orders) {
        const orderYahoo = t212ToYahooTicker(o.ticker, instrumentCache);
        if (normalizeTicker(orderYahoo) === normalizeTicker(pos.ticker) && isStopOrderType(o.type)) {
          const rawStopPrice = extractOrderStopPrice(o);
          pos.stopLoss = rawStopPrice != null ? rawStopPrice / divisor : null;
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

// ── Shared T212 positions cache (survives across routes, avoids 429 blanking) ──
let sharedT212Cache: T212Position[] = [];
let sharedT212CacheAt = 0;
const SHARED_CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Cached wrapper around getPositionsWithStopsMapped.
 * All routes should use this instead of calling getPositionsWithStopsMapped directly
 * to avoid hitting T212 rate limits when multiple routes fetch in quick succession.
 */
export async function getCachedT212Positions(settings: T212Settings): Promise<{ positions: T212Position[]; fromCache: boolean }> {
  const now = Date.now();
  if (sharedT212Cache.length > 0 && now - sharedT212CacheAt < SHARED_CACHE_TTL_MS) {
    return { positions: sharedT212Cache, fromCache: true };
  }
  try {
    const positions = await getPositionsWithStopsMapped(settings);
    sharedT212Cache = positions;
    sharedT212CacheAt = now;
    return { positions, fromCache: false };
  } catch (err) {
    // On failure, return stale cache if available
    if (sharedT212Cache.length > 0) {
      return { positions: sharedT212Cache, fromCache: true };
    }
    throw err;
  }
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
  const apiSecret = process.env["T212_API_SECRET"] ?? "";
  const env = (process.env["T212_ENVIRONMENT"] ?? "live") as "demo" | "live";
  const accountType = (process.env["T212_ACCOUNT_TYPE"] ?? "isa") as "invest" | "isa" | "both";

  if (!apiKey) return null;

  return {
    environment: env,
    apiKey,
    apiSecret,
    accountType,
  };
}

// ── Order management (write operations) ──

/**
 * Cancel a pending order by ID.
 * DELETE /api/v0/equity/orders/{id}
 */
export async function cancelOrder(settings: T212Settings, orderId: number): Promise<void> {
  await t212Fetch(`/equity/orders/${orderId}`, settings, { method: "DELETE" });
}

/**
 * Place a sell stop order on T212.
 * POST /api/v0/equity/orders/stop
 * quantity must be negative for a sell (stop-loss).
 * timeValidity = GOOD_TILL_CANCEL so it persists.
 */
export async function placeStopOrder(
  settings: T212Settings,
  t212Ticker: string,
  quantity: number,
  stopPrice: number,
): Promise<T212Order> {
  return t212Fetch("/equity/orders/stop", settings, {
    method: "POST",
    body: {
      ticker: t212Ticker,
      quantity: -Math.abs(quantity),
      stopPrice,
      timeValidity: "GOOD_TILL_CANCEL",
    },
  }) as Promise<T212Order>;
}

/**
 * Reverse-map a Yahoo-style ticker to the T212 internal ticker.
 * E.g. "HBR.L" → "PMOl_EQ", "AAPL" → "AAPL_US_EQ"
 * Returns null if no matching instrument found.
 */
export function yahooToT212Ticker(yahooTicker: string, instruments: T212Instrument[]): string | null {
  for (const inst of instruments) {
    const mapped = t212ToYahooTicker(inst.ticker, instruments);
    if (mapped === yahooTicker) return inst.ticker;
  }
  return null;
}

/**
 * Update (or create) a stop-loss on T212 for a given Yahoo ticker.
 * Flow:
 *   1. Find T212 instrument ticker
 *   2. Find existing stop order for this ticker → cancel it
 *   3. Place a new stop order at the new price
 *
 * stopPrice should be in the instrument's native currency.
 * For GBX instruments, caller must convert GBP → pence before calling.
 */
export async function updateStopOnT212(
  settings: T212Settings,
  yahooTicker: string,
  quantity: number,
  stopPriceGBP: number,
): Promise<{ cancelled: number | null; placed: T212Order }> {
  // Load instruments
  if (!instrumentCachePromise) {
    instrumentCachePromise = getInstruments(settings);
  }
  const instruments = await instrumentCachePromise;

  const t212Ticker = yahooToT212Ticker(yahooTicker, instruments);
  if (!t212Ticker) {
    throw new Error(`No T212 instrument found for ${yahooTicker}`);
  }

  // Convert GBP → GBX (pence) if instrument is priced in pence
  const pence = isT212Pence(t212Ticker, instruments);
  const stopPrice = pence ? stopPriceGBP * 100 : stopPriceGBP;

  // Find and cancel any existing stop order for this ticker
  let cancelledOrderId: number | null = null;
  const orders = await getPendingOrders(settings);
  const existingStop = orders.find(
    (o) => normalizeTicker(o.ticker) === normalizeTicker(t212Ticker) && isStopOrderType(o.type),
  );
  if (existingStop) {
    await cancelOrder(settings, existingStop.id);
    cancelledOrderId = existingStop.id;
    // T212 rate limit: wait after cancel before placing new order
    await sleep(2500);
  }

  // Place new stop order (negative quantity = sell/stop-loss)
  const placed = await placeStopOrder(settings, t212Ticker, quantity, stopPrice);
  return { cancelled: cancelledOrderId, placed };
}

/**
 * Place a market buy order on T212.
 * POST /api/v0/equity/orders/market
 * quantity must be positive for a buy.
 */
export async function placeMarketOrder(
  settings: T212Settings,
  t212Ticker: string,
  quantity: number,
): Promise<T212Order> {
  return t212Fetch("/equity/orders/market", settings, {
    method: "POST",
    body: {
      ticker: t212Ticker,
      quantity: Math.abs(quantity),
    },
  }) as Promise<T212Order>;
}

/**
 * Buy a stock on T212 by Yahoo ticker, then set the stop loss.
 * Flow:
 *   1. Map Yahoo ticker → T212 internal ticker
 *   2. Place market buy order
 *   3. Wait 2.5s for order to fill + rate limit
 *   4. Place stop-loss order
 *
 * Returns the market order and stop order results.
 */
export async function buyWithStop(
  settings: T212Settings,
  yahooTicker: string,
  quantity: number,
  stopPriceGBP: number,
): Promise<{ marketOrder: T212Order; stopOrder: T212Order }> {
  // Load instruments
  if (!instrumentCachePromise) {
    instrumentCachePromise = getInstruments(settings);
  }
  const instruments = await instrumentCachePromise;

  const t212Ticker = yahooToT212Ticker(yahooTicker, instruments);
  if (!t212Ticker) {
    throw new Error(`No T212 instrument found for ${yahooTicker}`);
  }

  // Place market buy
  const marketOrder = await placeMarketOrder(settings, t212Ticker, quantity);

  // Wait for fill + rate limit buffer
  await sleep(2500);

  // Convert GBP → GBX (pence) if instrument is priced in pence
  const pence = isT212Pence(t212Ticker, instruments);
  const stopPrice = pence ? stopPriceGBP * 100 : stopPriceGBP;

  // Place stop-loss order
  const stopOrder = await placeStopOrder(settings, t212Ticker, quantity, stopPrice);

  // Invalidate position cache so next fetch sees the new position
  sharedT212Cache = [];
  sharedT212CacheAt = 0;

  return { marketOrder, stopOrder };
}
