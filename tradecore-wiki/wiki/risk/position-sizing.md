---
title: "Position Sizing"
category: risk
tags: [position-sizing, kelly, risk, 2-percent]
updated: 2026-04-06
sources: []
confidence: high
---

Dollar-based Kelly-fraction position sizing with equity curve override.

## Formula

```
riskPerShare = suggestedEntry − hardStop
shares = (accountBalance × riskPct) / riskPerShare
```

Rounded to 4 decimal places (T212 supports fractional shares).

## Constraints

| Constraint | Value | Effect |
|-----------|-------|--------|
| Risk per trade | 2% of account | Hard cap on dollar risk |
| Max single exposure | 25% of account | Position size cap |
| Max positions | 5 (NORMAL), 3 (CAUTION), 0 (PAUSE) | Checked before sizing |
| PAUSE state | — | Returns null (no new entries) |

## Equity Curve Override

The [[equity-curve]] state machine modulates sizing:

| State | Risk Multiplier | Max Positions |
|-------|----------------|---------------|
| NORMAL | 1.0× (full 2%) | 5 |
| CAUTION | 0.5× (1%) | 3 |
| PAUSE | 0× | 0 |

## Implementation

File: `src/lib/risk/positionSizer.ts` (sacred — do not modify)

Key functions:
- `calculatePositionSize(signal, balance, equityCurveState)` → PositionSize | null
- `checkMaxPositions(openCount, maxAllowed)` → boolean

## See also

- [[equity-curve]]
- [[trailing-stops]]
- [[sacred-files]]
