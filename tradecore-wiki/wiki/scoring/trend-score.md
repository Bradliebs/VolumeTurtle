---
title: "Trend Score"
category: scoring
tags: [trend, scoring, moving-average]
updated: 2026-04-06
sources: []
confidence: high
---

Trend component of the [[composite-score]]. Weight: 30%.

## Calculation

Based on ticker's percentage above its 50-day moving average:

| % Above 50-day MA | Score |
|--------------------|-------|
| ≥ 20% | 1.0 |
| 10–20% | 0.8 |
| 0–10% | 0.6 |
| −5% to 0% | 0.3 |
| −15% to −5% | 0.1 |
| < −15% | 0.0 |

## Rationale

Stocks in strong uptrends are more likely to follow through on volume spike signals. Deep downtrend entries have high false-signal rates.

## See also

- [[composite-score]]
- [[regime-filter]]
