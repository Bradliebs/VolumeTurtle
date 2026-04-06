---
title: "Net Composite Score (NCS)"
category: scoring
tags: [ncs, composite, grading, scoring]
updated: 2026-04-06
sources: []
confidence: high
---

Primary signal grading system. Combines four weighted components into a single 0–1 score and A/B/C/D grade.

## Components

| Component | Weight | Range | Source |
|-----------|--------|-------|--------|
| Regime | 40% | 0.0–1.0 | [[regime-score]] |
| Trend | 30% | 0.0–1.0 | [[trend-score]] |
| Volume | 20% | 0.0–1.0 | [[volume-score]] |
| Liquidity | 10% | 0.2–1.0 | [[liquidity-score]] |

## Grade Thresholds

| Grade | Score | Interpretation |
|-------|-------|----------------|
| **A** | ≥ 0.75 | Strong conditions across all factors |
| **B** | 0.55–0.75 | Good signal, minor weaknesses |
| **C** | 0.35–0.55 | Marginal — consider passing |
| **D** | < 0.35 | Weak conditions — high false signal risk |

## Implementation

File: `src/lib/signals/compositeScore.ts` (sacred — do not modify)

Formula: `total = Σ(component × weight)`

Weights are env-overridable via `SCORE_WEIGHT_REGIME`, `SCORE_WEIGHT_TREND`, `SCORE_WEIGHT_VOLUME`, `SCORE_WEIGHT_LIQUIDITY`.

## See also

- [[regime-score]]
- [[trend-score]]
- [[volume-score]]
- [[liquidity-score]]
- [[breakout-power-score]]
- [[sacred-files]]
