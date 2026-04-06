---
title: "ADR: Equity Curve States"
category: decision
tags: [adr, equity-curve, drawdown, risk-modulation]
updated: 2026-04-06
sources: []
confidence: high
---

Adaptive risk via a three-state machine driven by account drawdown and equity moving average.

## Decision

**Date:** Pre-2026 (foundational)
**Status:** accepted

## Context

Fixed risk sizing ignores the system's recent performance. During drawdowns, continuing at full risk accelerates losses. During good runs, reducing risk leaves money on the table. A state machine provides mechanical adaptation.

## Decision

Three states based on drawdown from peak equity:

| State | Trigger | Effect |
|-------|---------|--------|
| NORMAL | DD < 10%, balance ≥ 20-day equity MA | Full 2% risk, max 5 positions |
| CAUTION | DD 10–20% or balance < equity MA | Half risk (1%), max 3 positions |
| PAUSE | DD ≥ 20% | No new entries |

## Rationale

- Protects capital during losing streaks
- PAUSE prevents catastrophic drawdown from snowballing
- CAUTION allows continued participation at reduced exposure
- 20-day equity MA catches gradual erosion that raw drawdown % might miss
- Thresholds (10%/20%) are conservative for a concentrated 5-position system

## Consequences

- During PAUSE, valid signals are missed — recovery requires patience
- State recomputed at each scan, so recovery is automatic once balance rebounds
- Minimum 5 snapshots needed for MA — new accounts default to NORMAL

## See also

- [[equity-curve]]
- [[position-sizing]]
