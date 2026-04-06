---
title: "Liquidity Score"
category: scoring
tags: [liquidity, scoring, dollar-volume]
updated: 2026-04-06
sources: []
confidence: high
---

Liquidity component of the [[composite-score]]. Weight: 10%.

## Calculation

Based on average daily dollar volume:

| Avg Dollar Volume | Score |
|-------------------|-------|
| ≥ $5M/day | 1.0 |
| ≥ $2M/day | 0.7 |
| ≥ $1M/day | 0.4 |
| < $1M/day | 0.2 |

## Rationale

Illiquid tickers have wider spreads and higher slippage risk. The floor of 0.2 (not 0.0) prevents outright rejection — some LSE small-caps trade thinner but are still valid.

## See also

- [[composite-score]]
