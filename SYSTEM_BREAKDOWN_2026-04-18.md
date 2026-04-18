# VolumeTurtle — Complete System Breakdown (April 2026)

> Snapshot after the autonomous self-tuning layer was added (2026-04-18).
> For the older signal-engine-focused breakdown see [SYSTEM_BREAKDOWN.md](SYSTEM_BREAKDOWN.md).

---

## 1. What it is

An algorithmic trading system that detects volume-spike entries on a curated equity universe, sizes positions by ATR risk, manages trailing stops mechanically, and (optionally) executes through Trading 212. It now also **self-evaluates and recommends parameter improvements weekly** using out-of-sample validation.

---

## 2. Stack

- **Frontend / API**: Next.js 14 + TypeScript strict
- **DB**: PostgreSQL via Prisma 7 (with `@prisma/adapter-pg`)
- **Scheduler**: Windows Task Scheduler (`schtasks`)
- **Broker**: Trading 212 (HTTP Basic Auth + REST)
- **Data**: Yahoo Finance (cached to `DailyQuote` table)
- **Notifications**: Telegram bot

---

## 3. Major subsystems

```
┌──────────────────────────────────────────────────────────────────────┐
│  SCAN ENGINE  (nightly, market-close × 2 sessions)                   │
│  Yahoo → DataValidator → RegimeFilter → CompositeScore → PendingOrder│
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│  AUTO-EXECUTOR  (every 5 min during market hours)                    │
│  13 pre-flight checks → T212 market order → stop placement → Trade   │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│  CRUISE CONTROL  (hourly, with intraday speedup window)              │
│  Read live prices → ratchet stops upward by ATR → push to T212       │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│  AUTO-TUNE  (weekly Sunday 19:00)                                    │
│  Parameter sweep → robustness check → OOS gate → recommendation file │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│  AUTONOMOUS AGENT  (Claude-powered, hourly weekdays + Sun/Fri) ★ NEW │
│  T212 check → equity curve → ratchets → pre-market risk → execute    │
│  13 tools │ Telegram control │ Sunday auto-tune │ Friday debrief     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Signal pipeline (the alpha)

| Stage | File | What it does |
|---|---|---|
| **Universe** | [data/universe.csv](data/universe.csv) → `Ticker` table (1480 active) | Manually curated tickers across LSE/US/EU |
| **Quote fetch** | [src/lib/data/fetchQuotes.ts](src/lib/data/fetchQuotes.ts) | Yahoo with batch + retry, cached to `DailyQuote` |
| **Data validator** | [src/lib/signals/dataValidator.ts](src/lib/signals/dataValidator.ts) | Sacred — staleness, gap, and continuity checks |
| **Regime filter** | [src/lib/signals/regimeFilter.ts](src/lib/signals/regimeFilter.ts) | Sacred — only enter when SPY/^FTSE in uptrend |
| **Volume signal** | [src/lib/signals/volumeSignal.ts](src/lib/signals/volumeSignal.ts) | Detects volume spikes ≥ 2× rolling avg with breakout |
| **Composite score** | [src/lib/signals/compositeScore.ts](src/lib/signals/compositeScore.ts) | Sacred — weighted A/B/C/D grading from regime/breakout/sector/liquidity |
| **Position sizer** | [src/lib/risk/positionSizer.ts](src/lib/risk/positionSizer.ts) | Sacred — `risk% × equity / (entry − stop)`, conviction-weighted |

---

## 5. Risk controls (live execution)

13 pre-flight checks in [src/lib/execution/autoExecutor.ts](src/lib/execution/autoExecutor.ts) — each can fail or adjust the order:

| # | Check | Purpose |
|---|---|---|
| 1 | Order freshness | Reject orders past cancel window |
| 2 | Account hours | Only execute during defined trading window |
| 3 | Daily limit | Max N orders/day |
| 4 | Grade floor | Must be ≥ `autoExecutionMinGrade` (default B) |
| 5 | Equity curve state | Pause/Caution drawdown gates |
| 6 | Live price gap | Cancel if open ≥ X% below signal close |
| 7 | Live price up-gap | Resize if open ≥ X% above signal close |
| 8 | Position open | Skip if already holding the ticker |
| 9 | Max positions | Hard cap on simultaneous open trades |
| 10 | T212 cash | Verify available balance |
| 11 | Exposure cap | Single position ≤ 25% of account |
| 12 | Sector concentration | Max 2 open positions per sector |
| **13** | **Portfolio heat cap** ★ NEW | Total open risk ≤ `HEAT_CAP_PCT` env var |

---

## 6. Trade lifecycle

```
PendingOrder (created by scan)
    ↓ pre-flight
Trade.status = OPEN  ←──┐
    ↓                    │
Cruise Control ratchets stop upward as price moves
    ↓                    │
T212 stop hit OR manual close
    ↓
Trade.status = CLOSED
```

Each hop persists to DB, with audit trails in `ExecutionLog`, `StopHistory`, `CruiseControlRatchetEvent`.

---

## 7. The autonomous self-tuning layer ★ NEW

This is what was built on 2026-04-18.

### 7.1 The 4 new scripts

| Script | Command | Purpose | Time |
|---|---|---|---|
| **Trade analyzer** | `npm run backtest:analyze -- --run=N` | Slice any past run by grade/exit/hold/sector/month + winners/losers | seconds |
| **Param sweep** | `npm run backtest:sweep` | Run engine across 108-combo grid, ranked leaderboard | ~7 min |
| **Auto-tune** | `npm run tune` | Sweep → pick robust winner → OOS validate → write recommendation | ~5 min |
| **Walk-forward** | `npm run walkforward` | Rigorous train/test fold validation, decay ratio, stability | ~5 min |

### 7.2 The robustness score

```
score = (PF − 1) × log(1 + trades) × CAGR / max(0.05, DD)
```

- Rewards profit factor *above 1.0* (raw PF would over-reward 5-trade flukes)
- Rewards trade count logarithmically (50 trades > 10 trades but not 5×)
- Rewards CAGR linearly
- Penalizes drawdown with a 5% floor (avoids div-by-zero bias to tiny-DD outliers)

### 7.3 The two-stage gate

```
Stage 1 — In-sample sweep
   Run all 54 combos on 2yr lookback, rank by score
   ↓
Stage 2 — Robustness check
   Best combo's 1-step neighbours must avg ≥ 50% of best score
   (catches isolated peaks vs. stable plateaus)
   ↓
Stage 3 — OOS validation gate ★
   Re-test the IS winner on 3 sequential 3-month OOS windows
   Pass requires: ≥2 valid windows, avg PF ≥ 1.2, ≥50% winning, ≥5 trades
   ↓
Verdict: PROMOTE_OK or OOS_GATE_FAILED
   ↓
Write JSON to data/recommendations/{latest, dated-archive}.json
   ↓
Send Telegram alert (--notify flag)
```

### 7.4 What the system has now learned

From running these on the data on 2026-04-18:

| Metric | Original (run #9) | OOS-validated winner |
|---|---|---|
| Grade floor | C | **B** (D's are noise) |
| Risk per trade | 2% (env default) | **1%** (env says half) |
| Heat cap | none | **8%** (now enforceable) |
| Sector cap | 2 | 2 (unchanged) |
| Win rate | 23.9% | **36.4%** |
| PF (in-sample) | 1.33 | **2.85** |
| PF (out-of-sample) | n/a | **3.42** ★ |
| Max DD | 13.93% | 11.66% |

---

## 8. Data model — key tables

```
Ticker            ← universe master
  ↓
DailyQuote        ← Yahoo cache
  ↓
PendingOrder     ← scan output, awaits execution
  ↓
Trade            ← live position, links to T212 order
  ↓
StopHistory     ← every stop change (cruise ratchets)
ExecutionLog    ← every pre-flight outcome
CruiseControlRatchetEvent  ← every intraday ratchet

BacktestRun     ← every backtest, including all sweep / WF / OOS runs
  ↓
BacktestTrade   ← simulated trades for analysis

UniverseSnapshot ← weekly POV-time-correct universe (anti-survivorship)
AccountSnapshot  ← daily T212 balance for equity curve
AppSettings      ← single-row DB-overridable config
AiSettings       ← agent on/off, model, API key
AgentHaltFlag    ← emergency halt with reason
AgentDecisionLog ← full audit trail of every agent cycle
```

---

## 9. Schedule (after `npm run schedule:setup` + `npm run schedule:agent:setup`)

| Task | When | What |
|---|---|---|
| `VolumeTurtle_Scan_LSE` | Mon-Fri 17:30 | Scan LSE post-close |
| `VolumeTurtle_Scan_US` | Mon-Fri 22:00 | Scan US post-close |
| `VolumeTurtle_ExecutionScheduler` | Mon-Fri every 5 min, 08:00–21:00 | Process PendingOrders → T212 |
| `VolumeTurtle_CruiseControl` | Mon-Fri hourly, 08:00–21:00 | Ratchet stops on open trades |
| `VolumeTurtle_UniverseSnapshot` | Sun 18:00 | Snapshot universe for backtest replay |
| `VolumeTurtle_AutoTune` | Sun 19:00 | Sweep + OOS-validate + recommend |
| `VolumeTurtle_Agent` | Mon-Fri hourly, 08:00–21:00 | Claude agent cycle (ratchets, executions, Telegram) |
| `VolumeTurtle_AgentListen` | Mon-Fri every 2 min, 08:00–21:00 | Telegram HALT/RESUME/STATUS listener |
| `VolumeTurtle_AgentSnapshot` | Sun 18:00 | Agent triggers universe snapshot |
| `VolumeTurtle_AgentAutoTune` | Sun 19:00 | Agent interprets auto-tune + sends verdict |
| `VolumeTurtle_AgentFriday` | Fri 21:30 | Weekly performance debrief to Telegram |

---

## 10. Configuration surface

Three layers, in order of precedence:

1. **AppSettings table** — DB-overridable runtime knobs (auto-execution, cruise polling, drawdown thresholds)
2. **Env vars** — boot-time strategy params (`RISK_PER_TRADE_PCT`, `HARD_STOP_ATR_MULTIPLE`, `HEAT_CAP_PCT`, etc.)
3. **Hardcoded defaults** — in [src/lib/config.ts](src/lib/config.ts)

Env-driven knobs the auto-tune currently recommends:

| Var | Current default | OOS-validated value |
|---|---|---|
| `RISK_PER_TRADE_PCT` | 2 | **1** |
| `HEAT_CAP_PCT` | (unset → off) | **0.08** |
| `HARD_STOP_ATR_MULTIPLE` | 1.5 | not yet swept |
| `TRAIL_ATR_MULTIPLE` | 2 | not yet swept |
| `ANTHROPIC_API_KEY` | (unset) | your Claude API key |
| `AGENT_ENABLED` | false | true when ready |
| `TRADECORE_BASE_URL` | http://localhost:3000 | agent API target |

---

## 11. Sacred files (do not modify)

Frozen — extend via new modules, never edit:

- [src/lib/signals/regimeFilter.ts](src/lib/signals/regimeFilter.ts)
- [src/lib/signals/compositeScore.ts](src/lib/signals/compositeScore.ts)
- [src/lib/signals/dataValidator.ts](src/lib/signals/dataValidator.ts)
- [src/lib/risk/positionSizer.ts](src/lib/risk/positionSizer.ts)
- [src/lib/risk/ratchetStops.ts](src/lib/risk/ratchetStops.ts)
- [src/lib/hbme/scanHelpers.ts](src/lib/hbme/scanHelpers.ts)
- [src/lib/hbme/breakoutEngine.ts](src/lib/hbme/breakoutEngine.ts)

---

## 12. What's still manual (and probably should stay that way)

| Boundary | Why manual |
|---|---|
| Promoting auto-tune recommendations to live env | Real money — agent sends verdict, human runs `setx` |
| Universe additions/removals | Strategy decision, not optimization |
| Telegram bot setup | Credentials |
| First-time T212 connection | API key entry |

---

## 13. Operational quick-reference

```powershell
# Install everything
.\INSTALL.bat
npm run schedule:setup

# Daily / on-demand
npm run scan                    # Manual scan
npm run scan:dry                # Preview without DB writes
npm run backup                  # Snapshot DB

# Backtesting & tuning ★ NEW
npm run backtest -- --start 2024-01-01 --end 2026-04-18 --capital 10000
npm run backtest:analyze -- --run=N    # Drill into a saved run
npm run backtest:sweep                  # Full 108-combo grid
npm run backtest:sweep:quick            # 8-combo smoke test
npm run tune                            # Auto-tune with OOS gate
npm run tune:notify                     # + Telegram
npm run walkforward                     # Honest train/test validation

# Health / debugging
npm run universe:health
npm run verify:execution
npm run schedule:status

# Agent
npm run agent                           # Manual agent cycle
npm run agent:sunday                    # Sunday maintenance
npm run agent:friday                    # Friday debrief
npm run agent:listen                    # Telegram listener
npm run schedule:agent:setup            # Install agent tasks
npm run schedule:agent:status           # Check agent tasks
npm run schedule:agent:remove           # Remove agent tasks
```

---

## 14. Summary in one paragraph

VolumeTurtle is a vertically-integrated trading platform: it collects market data, scans for volume-spike entries on a curated 1480-ticker universe, scores each signal A/B/C/D, and is managed by an **autonomous Claude-powered agent** that runs hourly during market hours. The agent checks T212 connectivity, monitors the equity curve for drawdown, ratchets stops, verifies tickers against T212, checks for pre-market binary events, flags position health concerns, and executes B+ grade signals — all while sending plain-English Telegram summaries. On Sundays it runs the auto-tune pipeline and sends an APPLY/MONITOR/IGNORE verdict; on Fridays it produces a weekly performance debrief. The system is auditable end-to-end (every order, stop, ratchet, and agent decision persisted to `AgentDecisionLog`), reproducible (UniverseSnapshot eliminates survivorship bias in backtests), and the strategy currently validates at PF 3.42 out-of-sample using G≥B, 1% risk, 8% portfolio heat cap.
