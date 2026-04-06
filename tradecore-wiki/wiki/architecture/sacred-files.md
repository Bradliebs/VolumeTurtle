---
title: "Sacred Files"
category: architecture
tags: [sacred, frozen, core-engine]
updated: 2026-04-06
sources: []
confidence: high
---

Six core engine files are frozen. Extend functionality via new modules — never edit these.

## Files

### 1. `src/lib/signals/regimeFilter.ts`

**Purpose:** Market regime detection — QQQ vs 200-day MA, VIX volatility states, individual ticker trend assessment.

**Key exports:**
- `calculateMarketRegime()` → RegimeState (BULLISH/BEARISH, NORMAL/ELEVATED/PANIC)
- `calculateTickerRegime(ticker, quotes)` → TickerRegime (UPTREND/DOWNTREND)
- `assessRegime(marketRegime, tickerRegime)` → RegimeAssessment (score 0–3, STRONG/CAUTION/AVOID)

**Why sacred:** Regime filter is the system's risk thermostat. Wrong regime assessment cascades into bad scores and bad position sizing across every trade.

---

### 2. `src/lib/signals/compositeScore.ts`

**Purpose:** Combine four scoring components (regime, trend, volume, liquidity) into a single A/B/C/D grade.

**Key exports:**
- `calculateCompositeScore(signal)` → CompositeScore (total 0–1, grade, component breakdown)

**Why sacred:** Every entry decision depends on the composite grade. Changing weights or thresholds invalidates all historical grading and backtest comparisons.

---

### 3. `src/lib/risk/positionSizer.ts`

**Purpose:** Dollar-based position sizing with equity curve override and max position enforcement.

**Key exports:**
- `calculatePositionSize(signal, balance, equityCurveState)` → PositionSize or null
- `checkMaxPositions(openCount, maxAllowed)` → boolean

**Why sacred:** Incorrect sizing directly risks the account. The 2% rule, 25% max exposure, and PAUSE gate are all enforced here.

---

### 4. `src/lib/risk/ratchetStops.ts`

**Purpose:** Nightly ratchet of trailing stops with monotonic floor enforcement and T212 sync.

**Key exports:**
- `ratchetAllStops(pushToT212?)` → RatchetResult (counts: processed, ratcheted, pushed, skipped)

**Why sacred:** The monotonic stop is the primary risk management mechanism. A bug here that lowers a stop could cause catastrophic loss.

---

### 5. `src/lib/hbme/scanHelpers.ts`

**Purpose:** Persist sector scores and momentum signals to the database after breakout scans.

**Key exports:**
- `saveSectorResults(sectors, scanRunId)` → saves ranked sectors
- `saveMomentumSignals(candidates, nearMisses, scanRunId)` → upserts breakout signals
- `updateMomentumTrailingStops()` → ratchets stops on momentum trades

**Why sacred:** Data persistence layer for the momentum engine. Schema assumptions are baked in.

---

### 6. `src/lib/hbme/breakoutEngine.ts`

**Purpose:** Detect sector momentum breakouts via 20-day MA, high volume, and sector rank.

**Key exports:**
- `findBreakouts(universe, priceMap, hotSectors, sectorScores, ...)` → { candidates, nearMisses }

**Why sacred:** The breakout detection logic (thresholds, ranking, near-miss criteria) is calibrated against historical sector rotation data. Changes risk both false positives and missed signals.

## Rule

If a modification to a sacred file is ever proposed, it must be flagged explicitly before proceeding. Consider creating a wrapper or extension module instead.

## See also

- [[overview]]
- [[composite-score]]
- [[regime-filter]]
- [[position-sizing]]
- [[trailing-stops]]
