# TradeCore — Ticker Selection Logic

> Two signal engines share one unified universe of ~1,280 tickers.
> Each engine applies its own filters on top of the shared pool.

---

## Shared Universe

The combined universe merges two sources:

| Source | File | Tickers | Has Metadata |
|--------|------|---------|-------------|
| Volume engine | `src/lib/universe/tickers.ts` (`HIGH_RISK_UNIVERSE`) | ~1,176 | No (ticker only) |
| Momentum CSV | `data/universe.csv` | ~208 | Yes (sector, name, market_cap) |

`loadUniverse()` in `src/lib/hbme/loadUniverse.ts` merges both:
- CSV rows go first (they have sector/name metadata)
- Volume-engine tickers not in CSV get added with sector "Unknown"
- Duplicates removed by ticker symbol
- **Combined total: ~1,280 unique tickers**

---

## Volume Engine Pipeline

File: `scripts/nightlyScan.ts` and `/api/scan`

| Step | Action | Result |
|------|--------|--------|
| 1 | `getUniverse()` loads from `HIGH_RISK_UNIVERSE` | ~1,176 tickers |
| 2 | Deduplication | Unique list |
| 3 | `fetchEODQuotes()` fetches 60-day history | Tickers with market data |
| 4 | `hasMinimumLiquidity()` filters low volume | Liquid candidates |
| 5 | `generateSignal()` checks volume spike + price confirmation | Signals fired |
| 6 | Sort by composite score descending | Best signals first |
| 7 | Enter trades up to max positions | Trades created |

### Volume Signal Criteria

| Condition | Formula | Default |
|-----------|---------|---------|
| Volume spike | `today.volume >= multiplier x avg_volume_20` | 2.0x |
| Price confirmation | `(close - low) / (high - low) >= threshold` | 0.75 |
| ATR available | ATR must compute (min 6 candles) | Required |

---

## Momentum Engine Pipeline

File: `src/lib/hbme/` and `/api/momentum/scan`

| Step | Action | Result |
|------|--------|--------|
| 1 | `loadUniverse()` loads merged CSV + volume tickers | ~1,280 tickers |
| 2 | `fetchEODQuotes()` fetches history (shared cache) | Tickers with data |
| 3 | `scoreSectors()` ranks sectors by R5/R20/volume | 9 sectors ranked |
| 4 | Top 5 sectors selected as "hot" | Hot sectors |
| 5 | `findBreakouts()` scans hot sector tickers | Breakout candidates |
| 6 | Save `SectorScanResult` + `MomentumSignal` rows | DB persisted |
| 7 | `updateMomentumTrailingStops()` on open momentum trades | Stops updated |

### Breakout Signal Criteria

| Condition | Formula | Default |
|-----------|---------|---------|
| Daily change | `chg1d >= BREAKOUT_MIN_CHG` | 10% |
| Volume ratio | `volRatio >= BREAKOUT_MIN_VOL` | 3.0x |
| Above SMA20 | `close > sma(20)` | Required |
| R5 positive | 5-day return > 0 | Required |
| R20 positive | 20-day return > 0 | Required |
| Hot sector | Ticker's sector in top 5 | Required |

### Momentum Score Components

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| Regime | 35% | QQQ trend + VIX + ticker trend |
| Breakout | 30% | Daily change + volume strength |
| Sector | 25% | Sector rank + sector score |
| Liquidity | 10% | Average daily volume |

---

## Liquidity Gate (Both Engines)

| Market | Min Avg Daily Dollar Volume |
|--------|---------------------------|
| US tickers | $1,000,000 |
| Non-US (.L, .AS, .ST, .HE, .CO) | $500,000 |

Calculated from last 20 bars: `avg(close x volume)`.
Min 10 bars required.

---

## Market Filtering

| Filter | Matches |
|--------|---------|
| `LSE` | Tickers ending `.L` |
| `EU` | Tickers ending `.AS`, `.ST`, `.HE`, `.CO` |
| `US` | All tickers without non-US suffixes |
| `ALL` | Full universe |

---

## Convergence Detection

The dashboard detects tickers flagged by **both** engines:
- Volume signals from today's scan
- Momentum signals from latest momentum scan
- Intersection = convergence tickers
- Highlighted with cyan "CONVERGENCE" alert

---

## Practical Summary

**Volume engine universe:** Edit `HIGH_RISK_UNIVERSE` in `src/lib/universe/tickers.ts`.
**Momentum engine universe:** Edit `data/universe.csv` (adds sector metadata).
Both are automatically merged by `loadUniverse()`.
