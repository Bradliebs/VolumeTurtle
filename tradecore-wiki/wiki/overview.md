---
title: "TradeCore — System Overview"
category: architecture
tags: [overview, system, summary]
updated: 2026-04-06
sources: []
confidence: high
---

TradeCore (VolumeTurtle) is a mechanical algorithmic trading system that detects volume spikes and sector momentum breakouts, sizes positions via Kelly-fraction risk, and manages exits with monotonic trailing stops.

## What It Is

A Next.js 14 + TypeScript + PostgreSQL application that:
- Scans 400+ equities across LSE, US, and EU markets
- Detects volume spike entries (VolumeTurtle engine) and sector momentum breakouts (HBME engine)
- Scores every signal with a 4-component composite grade (A/B/C/D)
- Sizes positions mechanically — 2% risk per trade, max 5 concurrent
- Manages exits via monotonic trailing stops with ATR hard floors
- Integrates with Trading 212 for execution and stop management

## Current State

- **Status:** Live
- **Engines:** 2 (VolumeTurtle volume spike + HBME momentum breakout)
- **Universe:** ~400 tickers (LSE, US, EU) loaded from `universe.csv`
- **Scans:** Scheduled via Windows Task Scheduler — LSE at 17:30, US at 22:00
- **Monitoring:** Cruise Control daemon runs hourly during market hours

## Non-Negotiable Constraints

- **2% rule:** Max 2% of account risked per trade
- **Max 5 positions** (reduced to 3 in CAUTION, 0 in PAUSE)
- **Max 25% exposure** per single position
- **Monotonic stops:** Stops only move up, never down
- **Sacred files:** Six core engine files are frozen — see [[sacred-files]]

## Major Subsystems

| Subsystem | Purpose | Key File(s) |
|-----------|---------|-------------|
| Volume Signal | Detect volume spikes + price confirmation | `signals/volumeSignal.ts` |
| Momentum/HBME | Sector breakout detection | `hbme/breakoutEngine.ts` |
| Regime Filter | Market/volatility/ticker trend assessment | `signals/regimeFilter.ts` |
| Composite Score | Grade signals A/B/C/D | `signals/compositeScore.ts` |
| Position Sizing | Kelly-fraction with equity curve override | `risk/positionSizer.ts` |
| Trailing Stops | Monotonic ratchet with ATR hard floor | `risk/ratchetStops.ts` |
| Equity Curve | System state machine (NORMAL/CAUTION/PAUSE) | `risk/equityCurve.ts` |
| Cruise Control | Intraday hourly stop ratchet | `cruise-control/` |
| T212 Client | Trading 212 API integration | `t212/client.ts` |

## Data Flow

Universe → Fetch (Yahoo Finance, 120-day) → Regime Assessment → Signal Generation → Composite Scoring → Position Sizing → Execution → Monitoring

See [[data-flow]] for the full pipeline diagram.

## See also

- [[sacred-files]]
- [[composite-score]]
- [[regime-filter]]
- [[position-sizing]]
- [[trailing-stops]]
- [[equity-curve]]
