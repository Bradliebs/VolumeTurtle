---
title: "Breakout Power Score (BPS)"
category: scoring
tags: [bps, breakout, momentum, scoring]
updated: 2026-04-06
sources: []
confidence: high
---

Scoring variant used by the HBME momentum breakout engine. Similar structure to [[composite-score]] but with different weights and components.

## Components

| Component | Weight | Range | Notes |
|-----------|--------|-------|-------|
| Regime | 35% | 0.0–1.0 | Same regime assessment as NCS |
| Breakout | 30% | 0.0–1.0 | 50% 1-day change + 50% volume ratio |
| Sector | 25% | 0.0–1.0 | 60% sector score + 40% sector rank |
| Liquidity | 10% | 0.2–1.0 | Same dollar volume tiers as NCS |

## Grade Thresholds

Same A/B/C/D scale as [[composite-score]]:
- A ≥ 0.75, B ≥ 0.55, C ≥ 0.35, D < 0.35

## Key Difference from NCS

NCS weights trend (30%) and volume (20%) as separate components. BPS replaces these with a combined breakout component (30%) and adds sector ranking (25%), reflecting that momentum signals depend on sector rotation rather than individual stock trend.

## Implementation

File: `src/lib/hbme/breakoutEngine.ts` (sacred — do not modify)

## See also

- [[composite-score]]
- [[momentum-breakout]]
- [[sacred-files]]
