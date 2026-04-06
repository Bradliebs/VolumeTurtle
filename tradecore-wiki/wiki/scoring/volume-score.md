---
title: "Volume Score"
category: scoring
tags: [volume, scoring, spike]
updated: 2026-04-06
sources: []
confidence: high
---

Volume component of the [[composite-score]]. Weight: 20%.

## Calculation

`score = max(0, (volumeRatio - 2.0) / 3.0)`

- Minimum qualifying ratio: 2.0x average volume
- Cap at 5.0x (score = 1.0)
- Linear interpolation between 2x and 5x

| Volume Ratio | Score |
|-------------|-------|
| < 2.0x | 0.0 (no signal) |
| 2.0x | 0.0 |
| 3.5x | 0.5 |
| 5.0x+ | 1.0 |

## Rationale

Volume spikes below 2x are noise. Above 5x, further volume doesn't meaningfully improve signal quality — institutional interest is already confirmed.

## See also

- [[composite-score]]
- [[volume-spike]]
