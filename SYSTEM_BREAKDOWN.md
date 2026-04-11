# TradeCore — Complete System Breakdown

> Dual-engine trading system: volume spikes (VolumeTurtle) + sector momentum breakouts (HBME).
> Mechanical signal generation. Human executes trades via Trading 212.

---

## Architecture

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 14, React 18, Tailwind CSS |
| **Backend** | Next.js API Routes (25+ endpoints) |
| **Database** | PostgreSQL via Prisma ORM |
| **Data Source** | Yahoo Finance (`yahoo-finance2`) |
| **Broker** | Trading 212 API (stop management + position sync) |
| **Scheduling** | Windows Task Scheduler (17:30 LSE, 22:00 US) |
| **Language** | TypeScript (strict mode) |

---

## Signal Engines

### Engine 1: Volume Spike (VolumeTurtle)

**Entry Signal** — two conditions must both be true:

| Condition | Formula | Default |
|-----------|---------|---------|
| Volume Spike | `today.volume >= multiplier x avg_volume_20` | 2.0x |
| Price Confirmation | `(close - low) / (high - low) >= threshold` | 0.75 |

**Composite Score** (ranks signals when multiple fire):

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| Regime | 40% | Market + volatility + ticker trend |
| Trend | 30% | Distance above/below 50-day MA |
| Volume | 20% | Spike strength (2x-5x, capped) |
| Liquidity | 10% | Average daily dollar volume |

### Engine 2: Sector Momentum Breakout (HBME)

**Sector Scoring:** Ranks all sectors by weighted R5/R20/volume metrics. Top 5 = "hot sectors."

**Breakout Signal** — all conditions must be true:

| Condition | Formula | Default |
|-----------|---------|---------|
| Daily change | `chg1d >= BREAKOUT_MIN_CHG` | 10% |
| Volume ratio | `volRatio >= BREAKOUT_MIN_VOL` | 3.0x |
| Above SMA20 | `close > sma(20)` | Required |
| R5 positive | 5-day return > 0 | Required |
| R20 positive | 20-day return > 0 | Required |
| Hot sector | Ticker in top 5 sectors | Required |

**Composite Score:**

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| Regime | 35% | QQQ + VIX + ticker trend |
| Breakout | 30% | Daily change + volume |
| Sector | 25% | Sector rank + score |
| Liquidity | 10% | Average daily volume |

### Convergence Detection

When a ticker is flagged by **both** engines, it's highlighted as a convergence signal on the dashboard.

---

## Signal Grades

| Grade | Score | Meaning |
|-------|-------|---------|
| **A** | >= 0.75 | Strong conditions across all factors |
| **B** | >= 0.55 | Good signal, minor weaknesses |
| **C** | >= 0.35 | Marginal — consider passing |
| **D** | < 0.35 | Weak conditions — high false signal risk |

---

## Regime Filter

Three-layer filter applied to both engines:

| Layer | Source | Green | Red |
|-------|--------|-------|-----|
| QQQ Trend | QQQ vs 200-day SMA | BULLISH (above) | BEARISH (below) |
| VIX | VIX level | < 25 NORMAL | 25-35 ELEVATED / > 35 PANIC |
| Ticker Trend | Ticker vs adaptive MA (30-50 day) | UPTREND (above) | DOWNTREND (below) |

**Overall:** 3/3 green = STRONG, 2/3 = CAUTION, 0-1 = AVOID

Ticker trend uses adaptive MA period: `Math.min(50, available_candles)`, minimum 30 candles required.

### Layer 4: Market Breadth

Optional 4th layer that modifies the regime assessment:

| Signal | Condition | Effect |
|--------|-----------|--------|
| STRONG | > 60% of universe above 50d MA | Full execution permitted |
| NEUTRAL | 40–60% above 50d MA | No change |
| WEAK | 20–40% above 50d MA | Grade B suspended — Grade A only |
| DETERIORATING | < 20% above 50d MA | All new entries blocked |

Breadth is calculated from the full universe and stored in `ScanRun.breadthScore` / `breadthSignal`.

---

## Exit Logic

| Parameter | Formula | Default |
|-----------|---------|---------|
| Hard Stop | `entry - (ATR x multiplier)` | 1.5x ATR |
| Trailing Stop | Lowest close over last N days | 10 days |

- Trailing stop **ratchets up only** — never moves down
- Active stop = `max(hardStop, trailingStop)`
- Exit triggers when `close < activeStop`
- ATR uses Wilder's smoothing, minimum 6 candles (adapts period if < 14)
- Fallback stop of 8% below price when ATR unavailable

---

## Equity Curve Circuit Breaker

| State | Trigger | Risk/Trade | Max Positions |
|-------|---------|-----------|--------------|
| **NORMAL** | Drawdown < 10% AND above equity MA20 | 2.0% | 5 |
| **CAUTION** | Drawdown >= 10% OR below equity MA20 | 1.0% | 3 |
| **PAUSE** | Drawdown >= 20% | 0% | 0 (exits only) |

Existing open trades are never affected — only new entries are gated.

---

## Universe

**~1,280 unique tickers** from two merged sources:

| Source | Count | Content |
|--------|-------|---------|
| `src/lib/universe/tickers.ts` | ~1,176 | Hardcoded ticker symbols |
| `data/universe.csv` | ~208 | Ticker + sector + name + market cap |

`loadUniverse()` merges both with deduplication. CSV rows provide metadata; volume-only tickers get sector "Unknown".

### Sectors Covered

Technology, Biotech, Healthcare, Energy, Financial Services, Consumer Discretionary, Industrials, Real Estate, and Unknown (volume-engine tickers without CSV metadata).

### Liquidity Filter

| Market | Min Avg Daily Dollar Volume |
|--------|---------------------------|
| US tickers | $1,000,000 |
| Non-US (.L, .AS, .ST, .HE, .CO) | $500,000 |

---

## Nightly Scan Flow

```
1.  Load account balance
2.  Calculate equity curve state (NORMAL/CAUTION/PAUSE)
3.  Calculate market regime (QQQ 200MA + VIX)
4.  Fetch 60-day OHLCV for volume universe (batched, cached)
5.  Filter by liquidity
6.  Generate volume signals (spike + confirmation + regime)
7.  Sort by composite score
8.  Process exits on open trades (hard stop + trailing stop)
9.  Update trailing stops (ratchet up only)
10. Enter new trades (if positions available)
11. Save AccountSnapshot
12. ── MOMENTUM SCAN (if enabled) ──
13. Load merged universe (~1,280 tickers)
14. Fetch prices (shared cache — no duplicate Yahoo calls)
15. Score sectors → save SectorScanResult rows
16. Find breakouts in hot sectors → save MomentumSignal rows
17. Update momentum trailing stops
18. Run alert check
19. Auto-backup
```

---

## Database Schema (PostgreSQL)

### 21 Models

| Model | Purpose |
|-------|---------|
| **Ticker** | Scanned symbols with sector info |
| **DailyQuote** | OHLCV price cache from Yahoo |
| **ScanRun** | Scan metadata (status, regime, timing, scanType, breadth) |
| **ScanResult** | Per-ticker volume scan result |
| **Trade** | Open/closed trades (supports signalSource: volume/momentum/manual) |
| **StopHistory** | Daily stop level changes per trade |
| **AccountSnapshot** | Daily balance snapshots |
| **Settings** | Key-value config store |
| **T212Connection** | Trading 212 credentials |
| **SectorScanResult** | Sector momentum rankings per scan |
| **MomentumSignal** | Breakout candidates + near misses (unique per ticker+scanRun) |
| **WatchlistItem** | User watchlist for monitoring |
| **Alert** | Breakout/stop alerts with acknowledge flow |
| **TelegramSettings** | Telegram bot notification config |
| **AppSettings** | DB-configurable parameters (momentum + auto-execution) |
| **PendingOrder** | Auto-execution order queue with cancellation window |
| **ExecutionLog** | Execution audit trail (per-order events) |
| **CruiseControlState** | Cruise daemon persistent state |
| **CruiseControlRatchetEvent** | Individual stop ratchet records |
| **CruiseControlAlert** | Cruise control alert history |
| **CruiseControlPollLog** | Poll cycle logs for cruise daemon |

---

## API Routes (47 Endpoints)

### Core Trading

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dashboard` | GET | Full dashboard data + momentum summary + convergence |
| `/api/scan` | GET | Run volume scan (dry or live) |
| `/api/scan/scheduled` | GET | Scheduled scan (token-auth, market filter) |
| `/api/trades` | POST | Create trade (supports signalSource, signalScore, signalGrade) |
| `/api/trades/[id]` | PATCH | Close/update a trade |
| `/api/trades/ratchet` | POST | Ratchet stops on open trades |
| `/api/trades/runner` | POST | Runner designation management |
| `/api/stops/[id]` | PATCH | Mark stop as actioned |
| `/api/balance` | PATCH | Update balance |
| `/api/journal` | GET | Trade journal data |
| `/api/breadth` | GET | Market breadth indicator |

### Auto-Execution

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/execution/pending` | GET/DELETE/POST | List, cancel, execute-now pending orders |
| `/api/execution/settings` | GET/POST | Auto-execution configuration |
| `/api/execution/push-stops` | GET/POST | List/retry unprotected positions |
| `/api/execution/log` | GET | Last 50 execution log entries |

### Momentum Engine

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/momentum/scan` | POST | Run momentum scan (dashboard-auth) |
| `/api/momentum/sectors` | GET | Latest sector rankings |
| `/api/momentum/signals` | GET | Signals with filters (?status, ?minGrade, ?sectors) |

### Cruise Control

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/cruise-control/state` | GET | Current cruise daemon state |
| `/api/cruise-control/toggle` | POST | Enable/disable cruise control |
| `/api/cruise-control/poll-now` | POST | Trigger immediate poll |
| `/api/cruise-control/activity` | GET | Recent poll activity |
| `/api/cruise-control/alerts` | GET | Cruise alert history |

### Trading 212

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/t212/test` | GET | Test T212 connection |
| `/api/t212/sync` | POST | Sync positions from T212 |
| `/api/t212/positions` | GET | Get T212 positions |
| `/api/t212/status` | GET | T212 connection status |
| `/api/t212/buy` | POST | Place market buy via T212 |
| `/api/t212/import` | POST | Import single T212 position |
| `/api/t212/import-all` | POST | Import all T212 positions |
| `/api/t212/stops/[id]` | PATCH | Push stop for specific trade |
| `/api/t212/stops/ticker` | GET | Get T212 stop for ticker |

### Positions & Sync

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/positions/sync-all` | POST | Sync all positions |
| `/api/positions/[id]/sync` | POST | Sync one position |

### Settings & Infrastructure

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/settings` | GET/PUT | System settings |
| `/api/settings/danger` | POST | Danger zone ops |
| `/api/settings/telegram` | GET/POST | Telegram notification config |
| `/api/settings/momentum` | GET/POST | Momentum engine parameters |
| `/api/alerts` | GET/POST/PATCH | Alert management |
| `/api/watchlist` | GET/POST/DELETE | Watchlist CRUD |
| `/api/account/size` | GET | Position sizing calculator |
| `/api/auth/login` | POST | Dashboard authentication |
| `/api/backup` | GET/POST | Backup management |
| `/api/export/trades` | GET | Export trades CSV/JSON |
| `/api/export/scans` | GET | Export scans |
| `/api/export/signals` | GET | Export signals |
| `/api/export/full` | GET | Full export |

---

## Frontend Pages

| Page | Route | Purpose |
|------|-------|---------|
| **Dashboard** | `/` | Main view: regime, equity curve, momentum summary, daily instructions, open positions, signal log, scan controls, trade history |
| **Execution** | `/execution` | Pending orders with live countdown timers, cancel/execute-now buttons, emergency disable, status filter |
| **Journal** | `/journal` | Trade journal with performance analytics and notes |
| **Momentum** | `/momentum` | Sector momentum table, breakout signal cards with entry panel, near misses |
| **Watchlist** | `/watchlist` | Ticker watchlist with source badges and CRUD |
| **Settings** | `/settings` | T212, Telegram, momentum engine config, risk params, auto-execution, alerts, backup, danger zone |
| **Login** | `/login` | Dashboard auth (cookie-based) |

### Navigation

```
DASHBOARD | EXECUTION | JOURNAL | MOMENTUM | WATCHLIST | SETTINGS
```

### Shared Components

| Component | Purpose |
|-----------|---------|
| `GradeBadge` | A/B/C/D coloured badge |
| `SignalPill` | VOL (cyan) / MOM (purple) / MAN (grey) source indicator |
| `RegimeBanner` | Full-width QQQ/VIX/assessment bar |
| `AlertPanel` | Bell icon + dropdown for unacknowledged alerts |
| `MomentumSummaryPanel` | Top sector, signal count, grade breakdown, convergence |
| `EquityCurvePanel` | System state + sparkline |
| `SignalCard` | Volume signal detail with regime + sizing |
| `ScanHistorySection` | Collapsible scan log |

---

## Trading 212 Integration

| Function | Purpose |
|----------|---------|
| Position sync | Pull live positions, prices, P&L |
| Stop management | Push/update stop-loss orders (cancel + replace) |
| Import positions | Import T212 positions into TradeCore tracking |
| Stop alignment | Detect T212 stop vs system stop mismatches |

Dashboard shows stop alignment status: ALL ALIGNED / UPDATES NEEDED / UNKNOWN.

---

## Auto-Execution System

Two-phase execution model with a cancellation window between signal detection and order placement.

### Pipeline

```
nightlyScan.ts → createPendingOrder() → [cancellation window] → executionScheduler.ts → processPendingOrder() → executeOrder() → T212 API
```

### Phase 1: Signal → Pending Order

During the nightly scan, Grade A/B signals (volume or momentum) create `PendingOrder` rows with a configurable cancellation window (default 15 min). User can cancel via dashboard or Telegram during this window.

### Phase 2: Execution Scheduler

Runs every 60 seconds during market hours (UTC 14:00–20:00). Picks up pending orders whose cancellation window has expired.

### 11 Pre-Flight Checks (ALL must pass)

| # | Check | Action on Fail |
|---|-------|---------------|
| 1 | **Cash Available** — T212 account has enough GBP | ABORT |
| 2 | **Price Validation** — live price drift from signal (>10% abort, 2-10% recalculate) | ABORT or ADJUST |
| 3 | **Position Limit** — max 5 open positions | ABORT |
| 4 | **Circuit Breaker** — full equity curve state (PAUSE blocks, CAUTION halves risk) | ABORT or ADJUST |
| 5 | **Regime Gate** — AVOID blocks all, CAUTION blocks Grade B + breadth checks | ABORT |
| 6 | **Data Validation** — ticker data quality | ABORT |
| 7 | **Duplicate Check** — no existing open trade for this ticker | ABORT |
| 8 | **Market Hours** — market state must be REGULAR or PRE | ABORT |
| 9 | **Minimum Order Size** — order value ≥ £1.00 | ABORT |
| 10 | **T212 Connection** — broker connected + live environment | ABORT |
| 11 | **Exposure Cap** — position ≤ 25% of account (reduces shares, doesn't block) | ADJUST |

### Order Placement

1. Map Yahoo ticker → T212 internal ticker
2. Place market buy via T212 API
3. Wait 2.5s for fill + rate limit buffer
4. Push stop loss (cancel existing → wait 2.5s → place new GTC stop)
5. Convert GBP → GBX (×100) for LSE stocks
6. Create Trade record + Telegram alert

### Safety Systems

| System | Description |
|--------|-------------|
| Cancellation window | 15-min (configurable) delay before execution |
| Emergency disable | Cancels all pending + disables globally |
| Daily limit | Max 2 orders/day (configurable) |
| Execution hours | UTC 14:00–20:00 only |
| Weekend guard | Scheduler skips Saturday/Sunday |
| Order expiry | Stale orders auto-expire after deadline + 5min |
| Stop push Layer 2 | Cruise daemon retries failed stop pushes hourly |
| Telegram alerts | Every state change notified |

### DB-Configurable Settings (AppSettings)

| Setting | Default | Description |
|---------|---------|-------------|
| `autoExecutionEnabled` | false | Global kill switch |
| `autoExecutionMinGrade` | B | Minimum signal grade |
| `autoExecutionWindowMins` | 15 | Cancellation window minutes |
| `autoExecutionMaxPerDay` | 2 | Max orders per day |
| `autoExecutionStartHour` | 14 | Execution window start (UTC) |
| `autoExecutionEndHour` | 20 | Execution window end (UTC) |

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | required | PostgreSQL connection |
| `VOLUME_TURTLE_BALANCE` | 1000 | Account balance |
| `MAX_POSITIONS` | 5 | Max open positions |
| `RISK_PER_TRADE_PCT` | 2 | Risk % per trade |
| `VOLUME_SPIKE_MULTIPLIER` | 2.0 | Volume spike threshold |
| `RANGE_POSITION_THRESHOLD` | 0.75 | Price range threshold |
| `ATR_PERIOD` | 20 | ATR period |
| `TRAILING_STOP_DAYS` | 10 | Trailing stop lookback |
| `HARD_STOP_ATR_MULTIPLE` | 1.5 | ATR multiplier for hard stop distance |
| `MOMENTUM_ENABLED` | true | Enable momentum engine |
| `BREAKOUT_MIN_CHG` | 0.10 | Min daily change for breakout |
| `BREAKOUT_MIN_VOL` | 3.0 | Min volume ratio for breakout |
| `SCORE_WEIGHT_REGIME` | 0.35 | Momentum regime weight |
| `SCORE_WEIGHT_BREAKOUT` | 0.30 | Momentum breakout weight |
| `SCORE_WEIGHT_SECTOR` | 0.25 | Momentum sector weight |
| `SCORE_WEIGHT_LIQUIDITY` | 0.10 | Momentum liquidity weight |
| `TELEGRAM_BOT_TOKEN` | — | Telegram notifications |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID |
| `SCHEDULED_SCAN_TOKEN` | — | Cron scan authentication |
| `DASHBOARD_TOKEN` | — | Dashboard auth (optional) |

### DB-Configurable (AppSettings)

Momentum engine weights and thresholds can also be set via the Settings page, stored in the `AppSettings` table. DB values override env vars.

---

## Deployment

### Quick Start

```
1. Unzip TradeCore
2. Double-click INSTALL.bat
   - Checks Node.js + Docker
   - Starts PostgreSQL
   - npm install
   - prisma generate + db push
   - Opens http://localhost:3000
```

### Daily Use

```
Double-click START.bat
```

### Scheduled Scans

```
npm run schedule:setup    # Create Windows tasks
npm run schedule:status   # Check status
npm run schedule:remove   # Remove tasks
```

### Package for Transfer

```
Double-click package.bat  # Creates zip excluding node_modules/.env
```
