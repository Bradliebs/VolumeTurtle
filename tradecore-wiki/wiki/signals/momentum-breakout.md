---
title: "Momentum Breakout Signal"
category: signal
tags: [momentum, breakout, hbme, sector]
updated: 2026-04-06
sources: []
confidence: high
---

HBME (High Beta Momentum Engine) signal. Detects sector-wide momentum breakouts in leading sectors.

## Process

1. **Sector scoring:** Rank all sectors by composite of R5 (5-day return), R20 (20-day return), and volume ratio
2. **Hot sector selection:** Top 5 sectors qualify for breakout scanning
3. **Breakout detection:** Within hot sectors, find tickers with:
   - Significant 1-day price change
   - Elevated volume ratio
   - Price above 20-day MA
4. **Composite scoring:** Grade candidates using [[breakout-power-score]]
5. **Near-miss tracking:** Tickers close to qualification stored for watchlist

## Output

| Field | Description |
|-------|-------------|
| `ticker` | Symbol |
| `sector` | Sector classification |
| `chg1d` | 1-day percentage change |
| `volRatio` | Volume vs average |
| `R5` / `R20` | 5-day / 20-day returns |
| `price` | Latest close |
| `compositeScore` | BPS grade + breakdown |

## Implementation

Files:
- `src/lib/hbme/breakoutEngine.ts` (sacred) — detection logic
- `src/lib/hbme/sectorEngine.ts` — sector ranking
- `src/lib/hbme/scanHelpers.ts` (sacred) — persistence
- `src/lib/hbme/alertEngine.ts` — Telegram alerts for breakouts

## See also

- [[breakout-power-score]]
- [[adr-sector-rank-filtering]]
- [[adr-two-engine-architecture]]
