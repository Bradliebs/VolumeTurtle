---
title: "Equity Curve State Machine"
category: risk
tags: [equity-curve, drawdown, system-state, risk-modulation]
updated: 2026-04-06
sources: []
confidence: high
---

Adaptive risk management via account drawdown tracking. Determines system state that modulates position sizing and max positions.

## States

| State | Trigger | Risk % | Max Positions |
|-------|---------|--------|---------------|
| **NORMAL** | Drawdown < 10% AND balance ≥ 20-day equity MA | 2% | 5 |
| **CAUTION** | Drawdown 10–20% OR balance < 20-day equity MA | 1% | 3 |
| **PAUSE** | Drawdown ≥ 20% | 0% | 0 (no entries) |

## Parameters

| Parameter | Default | Env Var |
|-----------|---------|---------|
| Caution threshold | 10% | `CAUTION_DRAWDOWN_PCT` |
| Pause threshold | 20% | `PAUSE_DRAWDOWN_PCT` |

## Requirements

- Minimum 5 account snapshots for 20-day equity MA calculation
- If not met, defaults to NORMAL
- State recomputed at every scan run

## Implementation

File: `src/lib/risk/equityCurve.ts`

Key function: `calculateEquityCurveState(snapshots, riskPct, maxPositions)` → EquityCurveState

## See also

- [[position-sizing]]
- [[adr-equity-curve-states]]
