---
title: "Volume Spike Signal"
category: signal
tags: [volume, spike, entry, signal]
updated: 2026-04-06
sources: []
confidence: high
---

Primary VolumeTurtle entry signal. Detects institutional-scale volume spikes with price confirmation.

## Trigger Conditions

All must be true:
1. **Volume spike:** Today's volume ≥ 2.0× 20-day average volume (`volumeSpikeMultiplier`)
2. **Price confirmation:** Close in top 25% of day's range (range position ≥ 0.75)
3. **Minimum liquidity:** Ticker passes dollar volume filter

## Signal Output

| Field | Description |
|-------|-------------|
| `ticker` | Symbol |
| `volumeRatio` | Today's volume / 20-day avg |
| `rangePosition` | (close − low) / (high − low) |
| `atr20` | 20-day ATR |
| `suggestedEntry` | Latest close |
| `hardStop` | Entry − (2 × ATR) |
| `riskPerShare` | Entry − hardStop |
| `compositeScore` | A/B/C/D grade + breakdown |

## Implementation

File: `src/lib/signals/volumeSignal.ts`

Key functions:
- `generateSignal(ticker, quotes, regime)` → VolumeSignal or null
- `isVolumeSpike(volumes, multiplier)` → boolean
- `isPriceConfirmed(quote, threshold)` → boolean
- `calculateAverageVolume(volumes, period)` → number

## See also

- [[composite-score]]
- [[regime-filter]]
- [[adr-range-position-filter]]
