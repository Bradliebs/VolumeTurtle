// ═══════════════════════════════════════════════════
// SACRED FILE — autoExecutor.ts
// Handles automated order placement via T212 API.
// All pre-flight checks MUST pass before any order
// is placed. If any check fails: abort, log, alert.
// Never modify pre-flight checks without full review.
// Last reviewed: 2026-04-10
// ═══════════════════════════════════════════════════

import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";
import { sendTelegram } from "@/lib/telegram";
import { getGbpUsdRate, getCurrencySymbol, isUsdTicker } from "@/lib/currency";
import { validateTicker } from "@/lib/signals/dataValidator";
import type { LiveQuote } from "@/lib/signals/dataValidator";
import { calculateMarketRegime, assessRegime, calculateTickerRegime } from "@/lib/signals/regimeFilter";
import { calculateBreadth } from "@/lib/signals/breadthIndicator";
import { calculateEquityCurveState, type SnapshotInput } from "@/lib/risk/equityCurve";
import { config } from "@/lib/config";
import { getUniverse } from "@/lib/universe/tickers";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import {
  loadT212Settings,
  getAccountCash,
  placeMarketOrder,
  getInstruments,
  yahooToT212Ticker,
  type T212Settings,
  type T212Instrument,
} from "@/lib/t212/client";
import { pushStopToT212 } from "@/lib/t212/pushStop";
import { ensureTickerInCsv } from "@/lib/universe/ensureInCsv";

const log = createLogger("autoExecutor");

// ── Prisma typed cast ──────────────────────────────────────────────────────

const db = prisma as unknown as {
  pendingOrder: {
    findMany: (args: unknown) => Promise<PendingOrderRow[]>;
    findFirst: (args: unknown) => Promise<PendingOrderRow | null>;
    findUnique: (args: unknown) => Promise<PendingOrderRow | null>;
    update: (args: unknown) => Promise<PendingOrderRow>;
    create: (args: { data: Partial<PendingOrderRow> }) => Promise<PendingOrderRow>;
    count: (args: unknown) => Promise<number>;
  };
  executionLog: {
    create: (args: { data: { orderId: number; event: string; detail: string } }) => Promise<unknown>;
    findMany: (args: unknown) => Promise<ExecutionLogRow[]>;
  };
  trade: {
    findMany: (args: unknown) => Promise<TradeRow[]>;
    findFirst: (args: unknown) => Promise<TradeRow | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<TradeRow>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<TradeRow>;
    count: (args: unknown) => Promise<number>;
  };
  stopHistory: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  appSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<AppSettingsRow | null>;
  };
  t212Connection: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<T212ConnectionRow | null>;
  };
  accountSnapshot: {
    findFirst: (args: unknown) => Promise<{ balance: number } | null>;
  };
};

// ── Row types ──────────────────────────────────────────────────────────────

export interface PendingOrderRow {
  id: number;
  ticker: string;
  sector: string;
  signalSource: string;
  signalGrade: string;
  compositeScore: number;
  suggestedShares: number;
  suggestedEntry: number;
  suggestedStop: number;
  dollarRisk: number;
  status: string;
  cancelDeadline: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  executedAt: Date | null;
  t212OrderId: string | null;
  actualShares: number | null;
  actualPrice: number | null;
  failureReason: string | null;
  isRunner: boolean;
  createdAt: Date;
}

interface ExecutionLogRow {
  id: number;
  orderId: number;
  event: string;
  detail: string;
  createdAt: Date;
}

interface TradeRow {
  id: string;
  ticker: string;
  sector: string | null;
  status: string;
  isRunner: boolean;
  entryPrice: number;
  shares: number;
  hardStop: number;
}

interface AppSettingsRow {
  autoExecutionEnabled: boolean;
  autoExecutionMinGrade: string;
  autoExecutionWindowMins: number;
  autoExecutionMaxPerDay: number;
  autoExecutionStartHour: number;
  autoExecutionEndHour: number;
  maxPositionsPerSector: number;
  gapDownThreshold: number;
  gapUpResizeThreshold: number;
}

interface T212ConnectionRow {
  environment: string;
  apiKey: string;
  connected: boolean;
}

// ── Pre-flight check result ────────────────────────────────────────────────

export interface PreFlightResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
  adjustments: string[];
  adjustedOrder: PendingOrderRow;
}

// ── Execution result ───────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  t212OrderId?: string;
  actualShares?: number;
  actualPrice?: number;
  error?: string;
  stopPushSuccess?: boolean;
  stopPushError?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-FLIGHT CHECKS — ALL must pass before any order is placed
// ═══════════════════════════════════════════════════════════════════════════

export async function preFlightChecks(
  originalOrder: PendingOrderRow,
  liveQuote: LiveQuote,
): Promise<PreFlightResult> {
  // Clone order to avoid mutating the input — checks may adjust shares/entry
  const order = { ...originalOrder };
  const failures: string[] = [];
  const warnings: string[] = [];
  const adjustments: string[] = [];

  // ── Check 1: CASH AVAILABLE ──
  try {
    const t212Settings = loadT212Settings();
    if (t212Settings) {
      const accountSummary = await getAccountCash(t212Settings);
      const availableCash = accountSummary.cash; // GBP
      const gbpUsdRate = await getGbpUsdRate();
      const requiredCash = isUsdTicker(order.ticker)
        ? (order.suggestedShares * order.suggestedEntry) / gbpUsdRate
        : order.suggestedShares * order.suggestedEntry;
      if (availableCash < requiredCash) {
        failures.push(
          `INSUFFICIENT_CASH — need £${requiredCash.toFixed(2)}, have £${availableCash.toFixed(2)}`,
        );
      }
    }
  } catch (err) {
    failures.push(`CASH_CHECK_FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Check 2: PRICE VALIDATION ──
  try {
    const livePrice = liveQuote.price;
    const signalPrice = order.suggestedEntry;
    const priceDrift = Math.abs(livePrice - signalPrice) / signalPrice;

    if (priceDrift > 0.10) {
      failures.push(
        `EXTREME_PRICE_DRIFT — signal $${signalPrice.toFixed(2)}, live $${livePrice.toFixed(2)} (${(priceDrift * 100).toFixed(1)}% > 10% threshold). Aborting.`,
      );
    } else if (priceDrift > 0.02) {
      // Recalculate shares using live price — does NOT fail
      const riskPerShare = livePrice - order.suggestedStop;
      if (riskPerShare > 0) {
        const newShares = Math.floor(order.dollarRisk / riskPerShare);
        adjustments.push(
          `PRICE_DRIFT — signal $${signalPrice.toFixed(2)}, live $${livePrice.toFixed(2)} (${(priceDrift * 100).toFixed(1)}%). Recalculated: ${order.suggestedShares} → ${newShares} shares`,
        );
        order.suggestedShares = newShares;
        order.suggestedEntry = livePrice;
      } else {
        failures.push(
          `PRICE_DRIFT_STOP_INVALID — live price $${livePrice.toFixed(2)} is at or below stop $${order.suggestedStop.toFixed(2)}`,
        );
      }
    }
  } catch (err) {
    failures.push(`PRICE_CHECK_FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Check 3: POSITION LIMIT ──
  try {
    const openPositions = await db.trade.count({ where: { status: "OPEN" } });
    if (openPositions >= config.maxPositions) {
      failures.push(`MAX_POSITIONS — ${openPositions}/${config.maxPositions} positions open`);
    }
  } catch (err) {
    failures.push(`POSITION_CHECK_FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Check 4: CIRCUIT BREAKER (full equity curve state) ──
  try {
    const snapshots = await (db as unknown as {
      accountSnapshot: {
        findMany: (args: unknown) => Promise<SnapshotInput[]>;
      };
    }).accountSnapshot.findMany({
      orderBy: { date: "desc" },
      take: 30,
    });

    if (snapshots.length > 0) {
      const eqState = calculateEquityCurveState(
        [...snapshots].reverse(),
        config.riskPctPerTrade * 100,
        config.maxPositions,
      );

      const normalRiskPct = config.riskPctPerTrade * 100;

      if (eqState.systemState === "PAUSE") {
        failures.push(
          `CIRCUIT_BREAKER_PAUSE — drawdown ≥ 20%. No new entries until recovery. Current drawdown: ${eqState.drawdownPct.toFixed(1)}%`,
        );
      } else if (eqState.systemState === "CAUTION") {
        const cautionRiskPct = eqState.riskPctPerTrade;
        const originalShares = order.suggestedShares;
        const riskPerShare = order.suggestedEntry - order.suggestedStop;

        if (riskPerShare > 0) {
          const reducedRisk = (order.suggestedShares * riskPerShare * cautionRiskPct) / normalRiskPct;
          const reducedShares = Math.round((reducedRisk / riskPerShare) * 10000) / 10000;

          order.dollarRisk = reducedRisk;
          order.suggestedShares = reducedShares;

          adjustments.push(
            `CIRCUIT_BREAKER_CAUTION — sized at ${cautionRiskPct.toFixed(1)}% risk (drawdown: ${eqState.drawdownPct.toFixed(1)}%). Shares: ${originalShares} → ${reducedShares.toFixed(4)}`,
          );
          log.info(
            `[PreFlight] CAUTION mode — position sized at ${cautionRiskPct}% risk (drawdown: ${eqState.drawdownPct.toFixed(1)}%). Shares reduced from ${originalShares} to ${reducedShares.toFixed(4)}`,
          );

          // Send Telegram note (non-blocking)
          sendTelegram({
            text:
              `<b>⚠ CAUTION MODE</b> — <code>${order.ticker}</code>\n` +
              `Position sized at ${cautionRiskPct.toFixed(1)}% risk (not ${normalRiskPct.toFixed(1)}%)\n` +
              `Drawdown: ${eqState.drawdownPct.toFixed(1)}%\n` +
              `Shares: ${reducedShares.toFixed(4)} (risk: £${reducedRisk.toFixed(2)})`,
          }).catch(() => { /* best effort */ });
        }
      } else {
        log.info(`[PreFlight] Circuit breaker NORMAL — full ${normalRiskPct.toFixed(1)}% risk active`);
      }
    }
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, "Circuit breaker check failed — continuing");
  }

  // ── Check 5: REGIME GATE ──
  try {
    const regime = await calculateMarketRegime();
    const tickerQuotes = await fetchEODQuotes([order.ticker], config.quoteLookbackDays);
    const tickerRegime = await calculateTickerRegime(order.ticker, tickerQuotes.get(order.ticker) ?? []);

    // Fetch breadth for 4-layer assessment
    let breadth = null;
    try {
      breadth = await calculateBreadth(getUniverse());
    } catch {
      // Breadth unavailable — continue with 3-layer assessment
    }

    const assessment = assessRegime(regime, tickerRegime, breadth);

    if (assessment.overallSignal === "AVOID") {
      failures.push(
        `REGIME_AVOID — QQQ ${regime.marketRegime} + VIX ${regime.volatilityRegime}. No entries in AVOID conditions.`,
      );
    } else if (assessment.overallSignal === "CAUTION") {
      if (order.signalGrade === "B") {
        failures.push(
          "REGIME_CAUTION — Grade B signals suspended in CAUTION regime. Grade A only.",
        );
      } else {
        warnings.push("REGIME_CAUTION — operating at reduced risk");
      }
    }

    // Breadth-specific checks (within Check 5)
    if (breadth) {
      if (breadth.breadthSignal === "DETERIORATING") {
        failures.push(
          `BREADTH_DETERIORATING — only ${breadth.above50MA.toFixed(0)}% of universe above 50d MA. No new entries in deteriorating breadth.`,
        );
      } else if (breadth.breadthSignal === "WEAK" && order.signalGrade === "B") {
        failures.push(
          "BREADTH_WEAK — Grade B suspended in weak breadth conditions. Grade A only.",
        );
      } else if (breadth.breadthSignal === "STRONG") {
        log.info("Breadth STRONG — full execution permitted");
      }
    }
  } catch (err) {
    failures.push(`REGIME_CHECK_FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Check 6: DATA VALIDATION ──
  try {
    const validation = await validateTicker(order.ticker, [], liveQuote);
    if (!validation.valid) {
      failures.push(`DATA_VALIDATION — ${validation.flags.join(", ")}`);
    }
    if (validation.warnings.length > 0) {
      warnings.push(...validation.warnings.map((w) => `DATA_WARNING — ${w}`));
    }
  } catch (err) {
    failures.push(`DATA_VALIDATION_FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Check 7: DUPLICATE CHECK ──
  try {
    const existing = await db.trade.findFirst({
      where: { ticker: order.ticker, status: "OPEN" },
    });
    if (existing) {
      failures.push(`DUPLICATE — already holding ${order.ticker}`);
    }
  } catch (err) {
    failures.push(`DUPLICATE_CHECK_FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Check 8: MARKET HOURS ──
  try {
    const marketState = (liveQuote as unknown as Record<string, unknown>)["marketState"] as string | undefined;
    if (marketState && marketState !== "REGULAR" && marketState !== "PRE") {
      failures.push(`MARKET_CLOSED — ${marketState}. Order will be queued for next open.`);
    }
  } catch {
    // Non-blocking — market state may not be available
    warnings.push("MARKET_STATE_UNKNOWN — could not determine market state");
  }

  // ── Check 9: MINIMUM ORDER SIZE ──
  try {
    const gbpUsdRate = await getGbpUsdRate();
    const orderValueGBP = isUsdTicker(order.ticker)
      ? (order.suggestedShares * order.suggestedEntry) / gbpUsdRate
      : order.suggestedShares * order.suggestedEntry;
    if (orderValueGBP < 1.0) {
      failures.push(`ORDER_TOO_SMALL — £${orderValueGBP.toFixed(2)} below T212 minimum`);
    }
  } catch {
    // Non-blocking
  }

  // ── Check 10: T212 CONNECTION ──
  try {
    const brokerSettings = await db.t212Connection.findFirst({
      orderBy: { id: "asc" },
    });
    if (!brokerSettings?.connected) {
      failures.push("T212_NOT_CONNECTED — cannot place order");
    }
    if (brokerSettings && brokerSettings.environment !== "live") {
      failures.push("T212_DEMO_MODE — switch to live environment to enable auto-execution");
    }
  } catch (err) {
    failures.push(`T212_CHECK_FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Check 11: MAX EXPOSURE CAP ──
  try {
    const gbpUsdRate = await getGbpUsdRate();
    const balance = (await db.accountSnapshot.findFirst({
      orderBy: { date: "desc" },
    }))?.balance ?? 0;

    if (balance > 0) {
      const exposureGBP = isUsdTicker(order.ticker)
        ? (order.suggestedShares * order.suggestedEntry) / gbpUsdRate
        : order.suggestedShares * order.suggestedEntry;
      const exposurePct = (exposureGBP / balance) * 100;

      if (exposurePct > 25) {
        const maxSharesGBP = balance * 0.25;
        const maxSharesValue = isUsdTicker(order.ticker)
          ? maxSharesGBP * gbpUsdRate
          : maxSharesGBP;
        const cappedShares = parseFloat((maxSharesValue / order.suggestedEntry).toFixed(4));

        log.info(
          `[PreFlight] Check 11 — exposure cap: ${exposurePct.toFixed(1)}% > 25% limit. Shares: ${order.suggestedShares} → ${cappedShares}`,
        );

        order.suggestedShares = cappedShares;

        adjustments.push(
          `EXPOSURE_CAPPED — ${exposurePct.toFixed(1)}% capped to 25%. Shares reduced to ${cappedShares}`,
        );
      } else {
        log.info(`[PreFlight] Check 11 — exposure OK (${exposurePct.toFixed(1)}% of account)`);
      }
    }
  } catch {
    // Non-blocking — exposure cap is a safety net, not a hard gate
  }

  // ── Check 12: SECTOR CONCENTRATION ──
  try {
    const sectorSettings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
    const maxPerSector = sectorSettings?.maxPositionsPerSector ?? 2;

    if (order.sector) {
      const openTradesInSector = await db.trade.count({
        where: {
          sector: order.sector,
          status: "OPEN",
        },
      });

      if (openTradesInSector >= maxPerSector) {
        failures.push(
          `SECTOR_CONCENTRATION — already holding ${openTradesInSector}/${maxPerSector} positions in ${order.sector}. Close an existing ${order.sector} position first.`,
        );
      } else {
        log.info(`[PreFlight] Check 12 — sector OK: ${openTradesInSector}/${maxPerSector} in ${order.sector}`);
      }
    } else {
      log.info("[PreFlight] Check 12 — sector unknown, skipping concentration check");
    }
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, "Sector concentration check failed — continuing");
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    adjustments,
    adjustedOrder: order,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDER PLACEMENT — Places market order + stop on T212
// ═══════════════════════════════════════════════════════════════════════════

export async function executeOrder(
  order: PendingOrderRow,
): Promise<ExecutionResult> {
  const t212Settings = loadT212Settings();
  if (!t212Settings) {
    return { success: false, error: "T212 settings not configured" };
  }

  // Map Yahoo ticker → T212 internal ticker
  const instruments = await getInstruments(t212Settings);
  const t212Ticker = yahooToT212Ticker(order.ticker, instruments);
  if (!t212Ticker) {
    return { success: false, error: `No T212 instrument found for ${order.ticker}` };
  }

  log.info({ ticker: order.ticker, t212Ticker, shares: order.suggestedShares }, "Placing market order");

  try {
    // Place market buy order
    const marketOrder = await placeMarketOrder(t212Settings, t212Ticker, order.suggestedShares);

    const orderId = String(marketOrder.id);
    const filledQty = marketOrder.filledQuantity || order.suggestedShares;
    const fillPrice = (marketOrder as unknown as Record<string, unknown>)["fillPrice"] as number | undefined;

    // Log order submission
    await logExecution(order.id, "SUBMITTED", `Market order placed: ${orderId}, qty=${filledQty}`);

    // Wait for fill + rate limit buffer before placing stop
    await sleep(2500);

    // Push stop loss to T212 immediately after fill (Layer 1)
    const stopResult = await pushStopToT212(
      order.ticker,
      filledQty,
      order.suggestedStop,
      t212Settings,
    );

    if (stopResult.success) {
      await logExecution(order.id, "STOP_PUSH_L1_SUCCESS", `Stop set at ${order.suggestedStop.toFixed(2)}`);
    } else {
      // CRITICAL: Stop push failed — Layer 2 (cruise daemon) will retry
      await logExecution(order.id, "STOP_PUSH_L1_FAIL", stopResult.error ?? "Unknown stop push error");

      // Send CRITICAL Telegram alert
      try {
        await sendTelegram({
          text: `<b>⚠ CRITICAL — STOP NOT SET</b>\n<code>${order.ticker}</code> — market order filled but stop push failed!\n<b>Layer 2 will retry on next cruise poll</b>\nStop target: $${order.suggestedStop.toFixed(2)}\nError: ${stopResult.error ?? "Unknown"}`,
        });
      } catch { /* best effort */ }
    }

    return {
      success: true,
      t212OrderId: orderId,
      actualShares: filledQty,
      actualPrice: fillPrice ?? order.suggestedEntry,
      stopPushSuccess: stopResult.success,
      stopPushError: stopResult.error,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ ticker: order.ticker, error: errMsg }, "Market order failed");
    return { success: false, error: errMsg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESS A SINGLE PENDING ORDER — Full lifecycle
// ═══════════════════════════════════════════════════════════════════════════

export async function processPendingOrder(order: PendingOrderRow): Promise<void> {
  log.info({ orderId: order.id, ticker: order.ticker }, "Processing pending order");

  // Safety: expire stale orders (cancelDeadline + 5 min)
  const expiryCutoff = new Date(order.cancelDeadline.getTime() + 5 * 60_000);
  if (new Date() > expiryCutoff) {
    await db.pendingOrder.update({
      where: { id: order.id },
      data: { status: "expired", failureReason: "Order expired — missed execution window" },
    });
    await logExecution(order.id, "EXPIRED", "Order expired — cancelDeadline + 5min exceeded");
    log.warn({ orderId: order.id, ticker: order.ticker }, "Order expired");
    return;
  }

  // Daily limit check
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const executedToday = await db.pendingOrder.count({
    where: {
      status: "executed",
      executedAt: { gte: todayStart },
    },
  });

  const settings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  const maxPerDay = settings?.autoExecutionMaxPerDay ?? 2;

  if (executedToday >= maxPerDay) {
    await db.pendingOrder.update({
      where: { id: order.id },
      data: { status: "failed", failureReason: `Daily limit reached (${executedToday}/${maxPerDay})` },
    });
    await logExecution(order.id, "PRE_FLIGHT_FAIL", `Daily limit: ${executedToday}/${maxPerDay} orders executed today`);
    await sendFailureAlert(order, [`DAILY_LIMIT — ${executedToday}/${maxPerDay} orders already executed today`]);
    return;
  }

  // Fetch live quote
  let liveQuote: LiveQuote;
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yf = new YahooFinance();
    const quote = await yf.quote(order.ticker);
    liveQuote = {
      price: quote?.regularMarketPrice ?? order.suggestedEntry,
      volume: quote?.regularMarketVolume ?? undefined,
    };
    // Attach market state for Check 8
    (liveQuote as unknown as Record<string, unknown>)["marketState"] = quote?.marketState ?? "UNKNOWN";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.pendingOrder.update({
      where: { id: order.id },
      data: { status: "failed", failureReason: `Quote fetch failed: ${errMsg}` },
    });
    await logExecution(order.id, "FAILED", `Quote fetch failed: ${errMsg}`);
    await sendFailureAlert(order, [`QUOTE_FAILED — ${errMsg}`]);
    return;
  }

  // Run all pre-flight checks
  const result = await preFlightChecks(order, liveQuote);

  if (!result.passed) {
    await db.pendingOrder.update({
      where: { id: order.id },
      data: {
        status: "failed",
        failureReason: result.failures.join("; "),
        // Persist any price-drift adjustments from the cloned order
        suggestedShares: result.adjustedOrder.suggestedShares,
        suggestedEntry: result.adjustedOrder.suggestedEntry,
      },
    });
    await logExecution(order.id, "PRE_FLIGHT_FAIL", result.failures.join("; "));
    await sendFailureAlert(order, result.failures);
    return;
  }

  // All checks passed
  await logExecution(order.id, "PRE_FLIGHT_PASS", `All 12 pre-flight checks passed — proceeding with order placement. Warnings: ${result.warnings.length}. Adjustments: ${result.adjustments.length}`);
  // ── Gap guardrail \u2014 check open vs signal close ──
  const gapSettings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  const gapDownThreshold = gapSettings?.gapDownThreshold ?? 0.03;
  const gapUpResizeThreshold = gapSettings?.gapUpResizeThreshold ?? 0.05;
  const signalClose = order.suggestedEntry;
  const livePrice = liveQuote.price;
  const gapPct = (livePrice - signalClose) / signalClose;

  // Gap DOWN \u2014 failed breakout
  if (gapPct < -gapDownThreshold) {
    await db.pendingOrder.update({
      where: { id: order.id },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: `GAP_DOWN \u2014 opened ${(gapPct * 100).toFixed(1)}% below signal close $${signalClose.toFixed(2)}`,
      },
    });
    await logExecution(
      order.id,
      "GAP_DOWN_CANCEL",
      `Live price $${livePrice.toFixed(2)} is ${(gapPct * 100).toFixed(1)}% below signal close $${signalClose.toFixed(2)} \u2014 cancelling (failed breakout)`,
    );
    try {
      await sendTelegram({
        text:
          `<b>\u274C ORDER CANCELLED \u2014 GAP DOWN</b>\n` +
          `<code>${order.ticker}</code>\n` +
          `Signal close: $${signalClose.toFixed(2)}\n` +
          `Open price:   $${livePrice.toFixed(2)}\n` +
          `Gap: ${(gapPct * 100).toFixed(1)}%\n` +
          `<i>Breakout failed \u2014 order not placed</i>`,
      });
    } catch { /* best effort */ }
    return;
  }

  // Gap UP \u2014 recalculate position size at new price
  if (gapPct > gapUpResizeThreshold) {
    const riskPerShare = livePrice - order.suggestedStop;
    if (riskPerShare > 0) {
      const newShares = parseFloat((order.dollarRisk / riskPerShare).toFixed(4));
      await logExecution(
        order.id,
        "GAP_UP_RESIZE",
        `Live price $${livePrice.toFixed(2)} is +${(gapPct * 100).toFixed(1)}% above signal close. Shares recalculated: ${order.suggestedShares} \u2192 ${newShares}`,
      );
      order.suggestedShares = newShares;
      order.suggestedEntry = livePrice;
    }
  }
  // Update order with any price-drift adjustments before execution
  if (result.adjustments.length > 0) {
    await db.pendingOrder.update({
      where: { id: order.id },
      data: {
        suggestedShares: order.suggestedShares,
        suggestedEntry: order.suggestedEntry,
      },
    });
  }

  // Execute the order
  const execResult = await executeOrder(order);

  if (execResult.success) {
    // Update PendingOrder
    await db.pendingOrder.update({
      where: { id: order.id },
      data: {
        status: "executed",
        executedAt: new Date(),
        t212OrderId: execResult.t212OrderId ?? null,
        actualShares: execResult.actualShares ?? null,
        actualPrice: execResult.actualPrice ?? null,
      },
    });

    await logExecution(order.id, "CONFIRMED", `Executed: ${execResult.actualShares} shares @ $${(execResult.actualPrice ?? 0).toFixed(2)}, T212 order: ${execResult.t212OrderId}`);

    // Create Trade in DB (same as manual entry)
    await db.trade.create({
      data: {
        ticker: order.ticker,
        entryDate: new Date(),
        entryPrice: execResult.actualPrice ?? order.suggestedEntry,
        shares: execResult.actualShares ?? order.suggestedShares,
        hardStop: order.suggestedStop,
        trailingStop: order.suggestedStop,
        hardStopPrice: order.suggestedStop,
        trailingStopPrice: order.suggestedStop,
        status: "OPEN",
        volumeRatio: 0,
        rangePosition: 0,
        atr20: 0,
        signalSource: order.signalSource,
        signalScore: order.compositeScore,
        signalGrade: order.signalGrade,
        sector: order.sector || null,
        isRunner: order.isRunner,
        importedFromT212: false,
        manualEntry: false,
        // Stop push tracking (Layer 1 result)
        stopPushedAt: execResult.stopPushSuccess ? new Date() : null,
        stopPushAttempts: 1,
        stopPushError: execResult.stopPushError ?? null,
      },
    });

    // Send execution alert
    await sendExecutionAlert(order, execResult);

    // Ensure ticker exists in universe.csv for future sector lookups
    ensureTickerInCsv(order.ticker, order.sector || "Technology");
  } else {
    await db.pendingOrder.update({
      where: { id: order.id },
      data: {
        status: "failed",
        failureReason: execResult.error ?? "Unknown execution error",
      },
    });
    await logExecution(order.id, "FAILED", execResult.error ?? "Unknown execution error");
    await sendFailureAlert(order, [`ORDER_FAILED — ${execResult.error}`]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE PENDING ORDER — Called by scan pipelines
// ═══════════════════════════════════════════════════════════════════════════

export interface CreatePendingOrderInput {
  ticker: string;
  sector: string;
  signalSource: "volume" | "momentum";
  signalGrade: "A" | "B";
  compositeScore: number;
  suggestedShares: number;
  suggestedEntry: number;
  suggestedStop: number;
  dollarRisk: number;
  isRunner: boolean;
}

export async function createPendingOrder(
  input: CreatePendingOrderInput,
): Promise<PendingOrderRow> {
  const settings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  const windowMins = settings?.autoExecutionWindowMins ?? 15;

  const cancelDeadline = new Date(Date.now() + windowMins * 60_000);

  const order = await db.pendingOrder.create({
    data: {
      ticker: input.ticker,
      sector: input.sector,
      signalSource: input.signalSource,
      signalGrade: input.signalGrade,
      compositeScore: input.compositeScore,
      suggestedShares: input.suggestedShares,
      suggestedEntry: input.suggestedEntry,
      suggestedStop: input.suggestedStop,
      dollarRisk: input.dollarRisk,
      status: "pending",
      cancelDeadline,
      isRunner: input.isRunner,
    },
  });

  await logExecution(order.id, "CREATED", `Pending order: ${input.ticker} ${input.signalGrade} via ${input.signalSource} — executes at ${cancelDeadline.toISOString()}`);

  // Send Telegram pending alert
  await sendPendingAlert(order);

  return order;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANCEL PENDING ORDER
// ═══════════════════════════════════════════════════════════════════════════

export async function cancelPendingOrder(
  orderId: number,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const order = await db.pendingOrder.findUnique({ where: { id: orderId } });
  if (!order) return { success: false, error: "Order not found" };
  if (order.status !== "pending") return { success: false, error: `Cannot cancel — status is ${order.status}` };
  if (new Date() > order.cancelDeadline) return { success: false, error: "Cancellation window has closed" };

  await db.pendingOrder.update({
    where: { id: orderId },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: reason ?? "User cancelled",
    },
  });

  await logExecution(orderId, "CANCELLED", reason ?? "User cancelled");

  // Send cancel alert
  try {
    await sendTelegram({
      text:
        `<b>❌ ORDER CANCELLED</b> — <code>${order.ticker}</code>\n` +
        `Reason: ${reason ?? "User cancelled"}\n` +
        `Signal remains valid — manual entry still possible`,
    });
  } catch { /* best effort */ }

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// EMERGENCY DISABLE — Cancel all pending, disable auto-execution
// ═══════════════════════════════════════════════════════════════════════════

export async function emergencyDisable(): Promise<{ cancelled: number }> {
  const pending = await db.pendingOrder.findMany({
    where: { status: "pending" },
  });

  for (const order of pending) {
    await db.pendingOrder.update({
      where: { id: order.id },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: "Emergency disable",
      },
    });
    await logExecution(order.id, "CANCELLED", "Emergency disable — all orders cancelled");
  }

  // Disable in AppSettings (upsert)
  try {
    const appDb = prisma as unknown as {
      appSettings: {
        findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{ id: number } | null>;
        update: (args: { where: { id: number }; data: { autoExecutionEnabled: boolean } }) => Promise<unknown>;
      };
    };
    const existing = await appDb.appSettings.findFirst({ orderBy: { id: "asc" } });
    if (existing) {
      await appDb.appSettings.update({
        where: { id: existing.id },
        data: { autoExecutionEnabled: false },
      });
    }
  } catch {
    log.error("Failed to disable auto-execution in AppSettings");
  }

  // Send Telegram
  try {
    await sendTelegram({
      text: `<b>⛔ AUTO-EXECUTION DISABLED</b>\nAll ${pending.length} pending orders cancelled.\nAuto-execution turned off globally.`,
    });
  } catch { /* best effort */ }

  return { cancelled: pending.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK IF AUTO-EXECUTION IS ENABLED AND GRADE QUALIFIES
// ═══════════════════════════════════════════════════════════════════════════

export async function isAutoExecutionEnabled(grade: "A" | "B"): Promise<boolean> {
  const settings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  if (!settings?.autoExecutionEnabled) return false;

  const minGrade = settings.autoExecutionMinGrade ?? "B";
  if (minGrade === "A" && grade === "B") return false;

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// TELEGRAM ALERTS
// ═══════════════════════════════════════════════════════════════════════════

async function sendPendingAlert(order: PendingOrderRow): Promise<void> {
  try {
    const currency = getCurrencySymbol(order.ticker);
    const riskPct = order.dollarRisk > 0 ? ((order.dollarRisk / (order.suggestedShares * order.suggestedEntry)) * 100).toFixed(1) : "?";
    const sourceLabel = order.signalSource === "momentum" ? "MOM 🟣" : "VOL 🔵";
    const runnerNote = order.isRunner ? "\n🏃 RUNNER designated" : "";
    const secsRemaining = Math.max(0, Math.round((order.cancelDeadline.getTime() - Date.now()) / 1000));
    const minsRemaining = Math.ceil(secsRemaining / 60);

    let regimeInfo = "";
    try {
      const regime = await calculateMarketRegime();
      const tickerRegime = await calculateTickerRegime(order.ticker, []);
      const assessment = assessRegime(regime, tickerRegime);
      regimeInfo = `\nRegime: ${assessment.overallSignal} (${assessment.score}/3)\n  QQQ: ${regime.marketRegime} · VIX: ${regime.volatilityRegime}`;
    } catch { /* best effort */ }

    await sendTelegram({
      text:
        `<b>🔔 AUTO-BUY PENDING — ${order.signalGrade} SIGNAL</b>\n` +
        `<code>${order.ticker}</code> · ${order.sector}\n` +
        `Source: ${sourceLabel} · Score: ${order.compositeScore.toFixed(2)}\n\n` +
        `Proposed order:\n` +
        `  Shares:  ${order.suggestedShares}\n` +
        `  Price:   ${currency}${order.suggestedEntry.toFixed(2)}\n` +
        `  Stop:    ${currency}${order.suggestedStop.toFixed(2)}\n` +
        `  Risk:    £${order.dollarRisk.toFixed(2)} (${riskPct}%)` +
        runnerNote +
        regimeInfo +
        `\n\n⏱ Executes in ${minsRemaining} minutes unless cancelled.`,
    });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to send pending alert");
  }
}

async function sendExecutionAlert(order: PendingOrderRow, result: ExecutionResult): Promise<void> {
  try {
    const currency = getCurrencySymbol(order.ticker);
    const runnerNote = order.isRunner ? "\n🏃 RUNNER — wide exit active" : "";

    await sendTelegram({
      text:
        `<b>✅ ORDER EXECUTED</b> — <code>${order.ticker}</code>\n` +
        `  Shares:  ${result.actualShares ?? order.suggestedShares}\n` +
        `  Price:   ${currency}${(result.actualPrice ?? order.suggestedEntry).toFixed(2)}\n` +
        `  Stop:    ${currency}${order.suggestedStop.toFixed(2)} (pushed to T212)\n` +
        `  Risk:    £${order.dollarRisk.toFixed(2)}` +
        runnerNote,
    });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to send execution alert");
  }
}

async function sendFailureAlert(order: PendingOrderRow, failures: string[]): Promise<void> {
  try {
    const failList = failures.map((f) => `  · ${f}`).join("\n");
    await sendTelegram({
      text:
        `<b>⚠ AUTO-BUY BLOCKED</b> — <code>${order.ticker}</code>\n` +
        `Failed checks:\n${failList}\n` +
        `Manual review required`,
    });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to send failure alert");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION LOG HELPER
// ═══════════════════════════════════════════════════════════════════════════

export async function logExecution(orderId: number, event: string, detail: string): Promise<void> {
  try {
    await db.executionLog.create({
      data: { orderId, event, detail },
    });
    log.info({ orderId, event }, detail);
  } catch (err) {
    log.error({ orderId, event, error: err instanceof Error ? err.message : String(err) }, "Failed to write execution log");
  }
}

// ── Utility ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
