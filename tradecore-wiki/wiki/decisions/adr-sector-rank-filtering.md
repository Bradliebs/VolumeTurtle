---
title: "ADR: Sector Rank Filtering"
category: decision
tags: [adr, sector, momentum, filtering]
updated: 2026-04-06
sources: []
confidence: high
---

Momentum breakout candidates must come from the top 5 ranked sectors.

## Decision

**Date:** Pre-2026 (foundational)
**Status:** accepted

## Context

Breakout signals fire across all sectors. Not all are equally likely to follow through. Sector momentum tends to concentrate — rallies begin in leading sectors and rotate outward.

## Decision

Only tickers from the top 5 sectors (ranked by composite of R5, R20, and volume ratio) qualify as breakout candidates. Tickers in lower-ranked sectors are rejected regardless of individual strength.

## Rationale

- Momentum concentrates in leading sectors — evidence from sector rotation research
- Reduces false positives from isolated moves in weak sectors
- Sector rank contributes 25% of BPS weight, making it a fundamental filter
- Top-5 cutoff balances breadth (not too narrow) with selectivity (not too broad)

## Consequences

- Strong individual breakouts in cold sectors will be missed
- This is accepted — the system targets sector momentum, not contrarian picks
- The near-miss system captures almost-qualifying signals for manual review

## See also

- [[momentum-breakout]]
- [[breakout-power-score]]
