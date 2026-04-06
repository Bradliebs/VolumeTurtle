---
title: "Data Flow Architecture"
category: architecture
tags: [architecture, pipeline, data-flow]
updated: 2026-04-06
sources: []
confidence: high
---

End-to-end scan pipeline from universe load to position monitoring.

## Pipeline

```
1. UNIVERSE LOAD
   • Load ~400 tickers from universe.csv by sector
   • Filter by minimum liquidity (volume × price threshold)
   
2. DATA FETCH
   • fetchEODQuotes(universe) — Yahoo Finance
   • 120-day historical per ticker
   • Batch: 10 tickers, 500ms delay (rate limit)
   
3. REGIME ASSESSMENT (once per scan)
   • calculateMarketRegime() — QQQ vs 200-day MA, VIX level
   • calculateEquityCurveState() — drawdown, system state
   
4. SIGNAL GENERATION (two parallel pipelines)
   
   ┌─ VOLUME PIPELINE ──────┐  ┌─ MOMENTUM PIPELINE ──────┐
   │ generateSignal()        │  │ scoreSectors()            │
   │  ├ isVolumeSpike()      │  │ findBreakouts()           │
   │  ├ isPriceConfirmed()   │  │  ├ pctChange (1d, 20d)    │
   │  ├ calculateATR()       │  │  ├ volRatio               │
   │  └ assessRegime()       │  │  └ sector rank            │
   └─────────────────────────┘  └───────────────────────────┘
   
5. COMPOSITE SCORING
   • calculateCompositeScore() — 4-component weighted total
   • Output: grade A/B/C/D + component breakdown
   
6. POSITION SIZING
   • calculatePositionSize(signal, balance, equityCurve)
   • Returns: shares, entry, stop, dollar risk
   • Checks: max positions, exposure limits, PAUSE gate
   
7. EXECUTION
   • Dry-run: save ScanResult only
   • Live: create Trade record, optionally place via T212 API
   
8. MONITORING (continuous)
   • Nightly trailing stop ratchet (ratchetAllStops)
   • Cruise Control daemon — hourly intraday ratchet
   • Exit signal evaluation (shouldExit)
   • Push updated stops to T212 (if enabled)
```

## Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/scan` | Manual volume spike scan |
| `/api/scan/scheduled` | Cron-triggered scan (LSE / US / ALL) |
| `/api/momentum/scan` | Sector momentum breakout scan |
| `/api/cruise-control` | Intraday stop ratchet status |

## See also

- [[overview]]
- [[volume-spike]]
- [[momentum-breakout]]
- [[composite-score]]
