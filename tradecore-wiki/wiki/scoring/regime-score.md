---
title: "Regime Score"
category: scoring
tags: [regime, scoring, qqq, vix]
updated: 2026-04-06
sources: []
confidence: high
---

Regime component of the [[composite-score]]. Weight: 40%.

## Calculation

Raw score = `regimeAssessment.score / 3` (normalised 0–1)

The regime assessment assigns 0–3 points:
- +1 if market is BULLISH (QQQ ≥ 200-day MA)
- +1 if volatility is NORMAL (VIX ≤ 25)
- +1 if ticker trend is UPTREND (close ≥ 50-day MA)

## Mapping

| Points | Raw | Signal |
|--------|-----|--------|
| 3 | 1.0 | STRONG |
| 2 | 0.67 | CAUTION |
| 1 | 0.33 | AVOID |
| 0 | 0.0 | AVOID |

## See also

- [[composite-score]]
- [[regime-filter]]
