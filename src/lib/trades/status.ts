interface AutoClosePolicyArgs {
  t212Configured: boolean;
  t212Loaded: boolean;
  t212StillHeld: boolean;
}

interface OpenTradeLike {
  id?: string;
  ticker: string;
  entryDate?: Date | string;
  entryPrice?: number;
  shares?: number;
}

interface ClosedTradeLike {
  id: string;
  ticker: string;
  entryDate: Date | string;
  exitDate: Date | string | null;
  createdAt?: Date | string;
  entryPrice?: number;
  shares?: number;
}

const TIMESTAMP_TOLERANCE_MS = 1_000;
const NUMBER_TOLERANCE = 0.0001;

function toTimestamp(value: Date | string | null): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function closedTradeRecency(trade: ClosedTradeLike): number {
  return Math.max(toTimestamp(trade.exitDate), toTimestamp(trade.entryDate));
}

export function canAutoCloseTrade({
  t212Configured,
  t212Loaded,
  t212StillHeld,
}: AutoClosePolicyArgs): boolean {
  if (!t212Configured) return true;
  return t212Loaded && !t212StillHeld;
}

export function findPhantomClosedTradeIds(args: {
  openTrades: OpenTradeLike[];
  closedTrades: ClosedTradeLike[];
  heldTickers: Iterable<string>;
}): Set<string> {
  const openTickers = new Set(args.openTrades.map((trade) => trade.ticker));
  const heldUntrackedTickers = new Set<string>();

  for (const ticker of args.heldTickers) {
    if (!openTickers.has(ticker)) {
      heldUntrackedTickers.add(ticker);
    }
  }

  const latestClosedByTicker = new Map<string, ClosedTradeLike>();
  for (const trade of args.closedTrades) {
    if (!heldUntrackedTickers.has(trade.ticker)) continue;

    const current = latestClosedByTicker.get(trade.ticker);
    if (!current || closedTradeRecency(trade) > closedTradeRecency(current)) {
      latestClosedByTicker.set(trade.ticker, trade);
    }
  }

  return new Set(Array.from(latestClosedByTicker.values(), (trade) => trade.id));
}

function sameNumber(left: number | undefined, right: number | undefined): boolean {
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= NUMBER_TOLERANCE;
}

function sameTimestamp(left: Date | string | undefined, right: Date | string | undefined): boolean {
  if (left == null || right == null) return false;
  return Math.abs(toTimestamp(left) - toTimestamp(right)) <= TIMESTAMP_TOLERANCE_MS;
}

export function findDuplicateClosedTradeIds(args: {
  openTrades: OpenTradeLike[];
  closedTrades: ClosedTradeLike[];
}): Set<string> {
  const openTradesByTicker = new Map<string, OpenTradeLike[]>();
  for (const trade of args.openTrades) {
    const existing = openTradesByTicker.get(trade.ticker) ?? [];
    existing.push(trade);
    openTradesByTicker.set(trade.ticker, existing);
  }

  const duplicateIds = new Set<string>();
  for (const closedTrade of args.closedTrades) {
    const openTrades = openTradesByTicker.get(closedTrade.ticker) ?? [];
    const hasTwin = openTrades.some((openTrade) =>
      sameTimestamp(openTrade.entryDate, closedTrade.entryDate)
      && sameNumber(openTrade.entryPrice, closedTrade.entryPrice)
      && sameNumber(openTrade.shares, closedTrade.shares),
    );

    if (hasTwin) {
      duplicateIds.add(closedTrade.id);
    }
  }

  return duplicateIds;
}

function closedEntryKey(trade: ClosedTradeLike): string | null {
  if (trade.entryPrice == null || trade.shares == null) return null;
  return [
    trade.ticker,
    toTimestamp(trade.entryDate),
    trade.entryPrice.toFixed(8),
    trade.shares.toFixed(8),
  ].join("|");
}

function closedSortTimestamp(trade: ClosedTradeLike): number {
  return Math.max(
    toTimestamp(trade.createdAt ?? null),
    toTimestamp(trade.exitDate),
    toTimestamp(trade.entryDate),
  );
}

export function findDuplicateClosedEntryIds(closedTrades: ClosedTradeLike[]): Set<string> {
  const groups = new Map<string, ClosedTradeLike[]>();

  for (const trade of closedTrades) {
    const key = closedEntryKey(trade);
    if (!key) continue;

    const existing = groups.get(key) ?? [];
    existing.push(trade);
    groups.set(key, existing);
  }

  const duplicateIds = new Set<string>();
  for (const trades of groups.values()) {
    if (trades.length <= 1) continue;

    const sorted = [...trades].sort((left, right) => closedSortTimestamp(right) - closedSortTimestamp(left));
    for (let i = 1; i < sorted.length; i++) {
      duplicateIds.add(sorted[i]!.id);
    }
  }

  return duplicateIds;
}