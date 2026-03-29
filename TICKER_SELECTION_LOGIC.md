# VolumeTurtle — Ticker Selection Logic

> How symbols move from the raw universe list to "ready" scan candidates.
> Mechanical pipeline: Universe -> Quotes -> Liquidity -> Signal Eligibility.

---

## Selection Pipeline

File path reference:
- Universe source: `src/lib/universe/tickers.ts`
- Scan runner: `scripts/nightlyScan.ts`

At runtime, the nightly scan does the following:

| Step | Action | Result |
|------|--------|--------|
| 1 | `getUniverse()` loads symbols from `HIGH_RISK_UNIVERSE` | Full raw list |
| 2 | `new Set(...)` deduplicates symbols | Unique universe |
| 3 | `fetchEODQuotes(universe)` fetches quote history | Symbols with market data |
| 4 | `hasMinimumLiquidity(ticker, quotes)` filters low-liquidity names | Liquid scan candidates |
| 5 | `generateSignal(...)` evaluates entry criteria | Signal-ready tickers |

---

## Universe Rules

### Hardcoded Universe (Active)

The scanner currently uses the hardcoded array in:
- `src/lib/universe/tickers.ts` (`HIGH_RISK_UNIVERSE`)

`getUniverse()` returns:
- all symbols from `HIGH_RISK_UNIVERSE`
- with duplicates removed

No ranking/filtering is applied inside `getUniverse()` besides deduplication.

### Market Filter Helper (Available)

`filterUniverseByMarket()` exists in `src/lib/universe/tickers.ts`, but is not currently called by `scripts/nightlyScan.ts`.

Supported options:

| Filter | Match Rule |
|--------|------------|
| `LSE` | Suffix `.L` |
| `EU` | Suffix `.AS`, `.ST`, `.HE`, `.CO` |
| `US` | Symbols without non-US suffixes |
| `ALL` | No market filtering |

---

## Liquidity Gate

File: `src/lib/universe/tickers.ts` (`hasMinimumLiquidity`)

Rules applied per ticker:

| Rule | Condition |
|------|-----------|
| Minimum bars | At least 10 bars in the last-20 window |
| Metric | Avg daily dollar volume = avg(close x volume) |
| US threshold | >= 1,000,000 |
| Non-US threshold | >= 500,000 for `.L`, `.AS`, `.ST`, `.HE`, `.CO` |

If a ticker fails this gate, it does not reach signal generation.

---

## "Ready" Ticker Criteria

A ticker is considered ready for entry evaluation only if all of the following are true:

1. It is in `HIGH_RISK_UNIVERSE`.
2. It returns valid quote data.
3. It passes `hasMinimumLiquidity()`.
4. `generateSignal(...)` returns non-null.

Inside `generateSignal(...)`, required conditions are:

| Condition | Formula | Default |
|-----------|---------|---------|
| Volume spike | `today.volume >= multiplier x avg_volume` | 2.0x |
| Price confirmation | `(close - low) / (high - low) >= threshold` | 0.75 |
| ATR available | `ATR20` must compute successfully | Required |

If any condition fails, the ticker is not signal-ready for that scan run.

---

## Ranking vs Selection

Signals are sorted by `compositeScore.total` (descending) in `scripts/nightlyScan.ts`.

Important distinction:
- Composite score orders priority.
- Composite grade does not hard-block entries by itself.

Actual entry still depends on downstream portfolio constraints (max positions, sizing validity, equity state).

---

## Data Sources Not Yet Driving Scan Membership

### DB Universe Manager

File: `src/lib/universe/manager.ts`

`getActiveUniverse()`, `addTicker()`, and `removeTicker()` manage DB-backed symbols, but `scripts/nightlyScan.ts` does not currently consume this DB universe.

### CSV Universe

File: `data/universe.csv`

`scripts/validateUniverse.ts` validates the CSV, but the nightly scanner does not build scan membership from this file today.

---

## Practical Summary

To change which symbols the scan can consider right now:
1. Edit `HIGH_RISK_UNIVERSE` in `src/lib/universe/tickers.ts`.
2. Ensure symbols have sufficient quote history and liquidity.
3. Run a dry scan to confirm they survive prefilters and can produce signals.
