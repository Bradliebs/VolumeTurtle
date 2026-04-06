// ═══════════════════════════════════════════════
// SACRED FILE — dataValidator.ts
// Do not modify validation thresholds without
// updating this comment with the reason and date.
// Thresholds:
//   EXTREME_MOVE:        25% daily change
//   SPLIT_SUSPECTED:     40% move + <0.5x volume
//   HIGH_MOVE_WARNING:   15% daily change
//   VOLUME_SPIKE_WARNING: 20x volume ratio
// Last reviewed: 2026-04-06
// ═══════════════════════════════════════════════

import { createLogger } from "@/lib/logger";
import { crossValidateMove } from "@/lib/data/crossValidator";

const log = createLogger("dataValidator");

export interface Candle {
  date: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveQuote {
  price: number;
  volume?: number;
}

export interface ValidationResult {
  ticker: string;
  valid: boolean;
  warnings: string[];
  flags: string[];
  rawMove: number;
  volumeRatio: number;
  dataSource: string;
  crossValidated: boolean;
}

// ── Thresholds ──

const EXTREME_MOVE_THRESHOLD = 0.25;
const SPLIT_SUSPECTED_MOVE = 0.40;
const SPLIT_SUSPECTED_VOL_RATIO = 0.5;
const HIGH_MOVE_THRESHOLD = 0.15;
const VOLUME_SPIKE_WARNING_THRESHOLD = 20;
const MIN_CANDLES = 5;
const THIN_HISTORY_THRESHOLD = 14;
const STALE_DATA_MAX_TRADING_DAYS = 2;

// ── Helpers ──

function avgVolume(candles: Candle[], period: number): number {
  // Use candles before the last one (historical average)
  const hist = candles.slice(0, -1).slice(-period);
  if (hist.length === 0) return 0;
  return hist.reduce((sum, c) => sum + c.volume, 0) / hist.length;
}

function tradingDaysAgo(dateStr: string, now: Date): number {
  const d = new Date(dateStr);
  let count = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);

  while (cursor > target) {
    cursor.setDate(cursor.getDate() - 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// ── Main validator ──

export async function validateTicker(
  ticker: string,
  candles: Candle[],
  quote: LiveQuote | null,
): Promise<ValidationResult> {
  const flags: string[] = [];
  const warnings: string[] = [];
  let rawMove = 0;
  let volumeRatio = 0;
  let dataSource = "yahoo";
  let crossValidated = false;

  // 4. INSUFFICIENT_HISTORY (check first — other rules need candles)
  if (candles.length < MIN_CANDLES) {
    flags.push(`INSUFFICIENT_HISTORY — ${candles.length} candles, need ${MIN_CANDLES}`);
    return { ticker, valid: false, warnings, flags, rawMove, volumeRatio, dataSource, crossValidated };
  }

  const today = candles[candles.length - 1]!;
  const yesterday = candles[candles.length - 2]!;
  const todayClose = quote?.price ?? today.close;
  const prevClose = yesterday.close;

  // Calculate key metrics
  rawMove = prevClose !== 0 ? (todayClose - prevClose) / prevClose : 0;
  const absMove = Math.abs(rawMove);
  const avg20 = avgVolume(candles, 20);
  volumeRatio = avg20 > 0 ? today.volume / avg20 : 0;

  // 2. ZERO_VOLUME
  if (today.volume === 0 || today.volume == null) {
    flags.push("ZERO_VOLUME — no trading activity today");
  }

  // 3. PRICE_ANOMALY
  if (
    today.close <= 0 ||
    today.close > today.high * 1.01 ||
    today.close < today.low * 0.99
  ) {
    flags.push("PRICE_ANOMALY — close outside high/low range");
  }

  // 5. STALE_DATA
  const todayDate = typeof today.date === "string" ? today.date : today.date.toISOString().slice(0, 10);
  const now = new Date();
  const staleDays = tradingDaysAgo(todayDate, now);
  if (staleDays > STALE_DATA_MAX_TRADING_DAYS) {
    flags.push(`STALE_DATA — last candle ${todayDate}, expected recent`);
  }

  // 6. SPLIT_SUSPECTED
  if (absMove > SPLIT_SUSPECTED_MOVE && volumeRatio < SPLIT_SUSPECTED_VOL_RATIO) {
    flags.push(
      `SPLIT_SUSPECTED — ${(absMove * 100).toFixed(1)}% move on ${volumeRatio.toFixed(2)}x volume, possible stock split or data error`,
    );
  }

  // 1. EXTREME_MOVE (with cross-validation)
  if (absMove > EXTREME_MOVE_THRESHOLD) {
    // Don't double-flag if already suspected as split
    const alreadySplit = flags.some((f) => f.startsWith("SPLIT_SUSPECTED"));
    if (!alreadySplit) {
      try {
        const cv = await crossValidateMove(ticker, rawMove);
        crossValidated = cv.confirmed;
        if (cv.confirmed) {
          dataSource = "cross-validated";
          warnings.push(
            `EXTREME_MOVE_CONFIRMED — ${(absMove * 100).toFixed(1)}% verified by ${cv.source}`,
          );
        } else {
          flags.push(
            `EXTREME_MOVE — ${(absMove * 100).toFixed(1)}% exceeds ${EXTREME_MOVE_THRESHOLD * 100}% threshold (${cv.source})`,
          );
        }
      } catch {
        flags.push(
          `EXTREME_MOVE — ${(absMove * 100).toFixed(1)}% exceeds ${EXTREME_MOVE_THRESHOLD * 100}% threshold (cross-validation failed)`,
        );
      }
    }
  }

  // ── Non-blocking warnings ──

  // HIGH_MOVE_WARNING
  if (absMove > HIGH_MOVE_THRESHOLD && absMove <= EXTREME_MOVE_THRESHOLD) {
    warnings.push(
      `HIGH_MOVE — ${(absMove * 100).toFixed(1)}% is elevated, monitor for data quality`,
    );
  }

  // VOLUME_SPIKE_WARNING
  if (volumeRatio > VOLUME_SPIKE_WARNING_THRESHOLD) {
    warnings.push(
      `VOLUME_SPIKE — ${volumeRatio.toFixed(1)}x is unusually high, possible data error`,
    );
  }

  // THIN_HISTORY_WARNING
  if (candles.length < THIN_HISTORY_THRESHOLD && candles.length >= MIN_CANDLES) {
    warnings.push(
      `THIN_HISTORY — ${candles.length} candles, ATR estimate only`,
    );
  }

  const valid = flags.length === 0;

  if (flags.length > 0) {
    log.warn({ ticker, flags, rawMove: (rawMove * 100).toFixed(1) + "%" }, "Ticker blocked by data validation");
  }
  if (warnings.length > 0) {
    log.info({ ticker, warnings }, "Data validation warnings");
  }

  return { ticker, valid, warnings, flags, rawMove, volumeRatio, dataSource, crossValidated };
}
