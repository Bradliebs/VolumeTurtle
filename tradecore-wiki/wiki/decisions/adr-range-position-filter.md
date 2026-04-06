---
title: "ADR: Range Position Filter"
category: decision
tags: [adr, range-position, price-confirmation, entry]
updated: 2026-04-06
sources: []
confidence: high
---

Volume spike entries require the close to be in the top 25% of the day's high-low range.

## Decision

**Date:** Pre-2026 (foundational)
**Status:** accepted

## Context

Volume spikes occur for many reasons — not all bullish. A stock can spike volume on a sell-off, closing near its low. Requiring the close near the high filters for genuine buying pressure.

## Decision

Range position threshold: 0.75 (top 25% of range).

```
rangePosition = (close − low) / (high − low)
```

Signal only fires if `rangePosition ≥ 0.75`.

## Rationale

- Filters out high-volume reversals and distribution days
- A close near the high indicates buyers dominated the session
- 0.75 threshold is restrictive enough to filter noise but not so tight that it misses strong closes with normal intraday volatility

## Consequences

- Some legitimate breakouts with mid-range closes will be missed
- Accepted trade-off: fewer signals, higher quality
- The threshold is env-configurable but not typically changed

## See also

- [[volume-spike]]
- [[composite-score]]
