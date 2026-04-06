---
title: "Trailing Stops"
category: risk
tags: [stops, trailing, monotonic, atr, ratchet]
updated: 2026-04-06
sources: []
confidence: high
---

Monotonic trailing stop system with ATR hard floor. The primary exit mechanism.

## Two Stop Levels

| Stop | Calculation | Behaviour |
|------|-------------|-----------|
| **Hard stop** | Entry − (2 × 20-day ATR) | Immovable floor, set at entry |
| **Trailing stop** | Running 10-day low | Ratchets up nightly, never down |

Active stop = `max(hardStop, trailingStopPrice)`

## Exit Triggers

- Close ≤ active stop → exit
- `shouldExit(currentClose, quotes)` checks trailing stop breach

## Monotonic Enforcement

The trailing stop can ONLY rise or stay flat. Never falls. Enforced as:

```
newStop = max(currentTrailingStop, calculated10DayLow)
```

## Ratchet Process (Nightly)

1. Load all OPEN trades
2. Re-fetch quote history (120-day lookback)
3. Calculate new trailing stop (10-day low)
4. Enforce monotonic guard: new ≥ old
5. Check T212 floor: never push lower stop than T212's current
6. Persist updated stop + stop history record

## Stop Source Attribution

| Condition | Source |
|-----------|--------|
| Trailing > hard | `"trailing"` |
| Hard ≥ trailing | `"atr"` |

## Implementation

Files:
- `src/lib/risk/ratchetStops.ts` (sacred) — nightly ratchet engine
- `src/lib/signals/exitSignal.ts` — `shouldExit()`, `updateTrailingStop()`
- `scripts/cruise-daemon.ts` — intraday hourly ratchet

## See also

- [[position-sizing]]
- [[adr-monotonic-stops]]
- [[cruise-control]]
- [[sacred-files]]
