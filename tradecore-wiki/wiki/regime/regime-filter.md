---
title: "Regime Filter"
category: regime
tags: [regime, qqq, vix, market, volatility, trend]
updated: 2026-04-06
sources: []
confidence: high
---

Three-layer regime assessment: market direction, volatility environment, and individual ticker trend.

## Layer 1: Market Regime (QQQ vs 200-day MA)

| Condition | State |
|-----------|-------|
| QQQ close ≥ 200-day MA | **BULLISH** |
| QQQ close < 200-day MA | **BEARISH** |

Data: 280 days of QQQ history fetched from Yahoo Finance.

## Layer 2: Volatility Regime (VIX)

| VIX Level | State | Impact |
|-----------|-------|--------|
| ≤ 25 | **NORMAL** | Full scoring |
| 25–35 | **ELEVATED** | Warning: "increased false signal risk" |
| > 35 | **PANIC** | Warning: "high false signal risk" |

Data: 5 most recent VIX closes.

## Layer 3: Ticker Trend (50-day MA)

| Condition | State |
|-----------|-------|
| Close ≥ 50-day MA | **UPTREND** |
| Close < 50-day MA | **DOWNTREND** |
| < 30 days data | **INSUFFICIENT_DATA** |

## Combined Assessment

Score 0–3 (one point per favourable layer):

| Score | Signal | Meaning |
|-------|--------|---------|
| 3 | **STRONG** | All conditions favourable |
| 2 | **CAUTION** | One adverse factor |
| ≤ 1 | **AVOID** | Multiple headwinds |

This score feeds into [[regime-score]] at 40% weight.

## Implementation

File: `src/lib/signals/regimeFilter.ts` (sacred — do not modify)

## See also

- [[regime-score]]
- [[composite-score]]
- [[equity-curve]]
