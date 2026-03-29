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

---

## Exit Logic

| Parameter | Formula | Default |
|-----------|---------|---------|
| Hard Stop | `entry - (ATR x multiplier)` | 2.0x ATR |
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

### 18 Models

| Model | Purpose |
|-------|---------|
| **Ticker** | Scanned symbols with sector info |
| **DailyQuote** | OHLCV price cache from Yahoo |
| **ScanRun** | Scan metadata (status, regime, timing, scanType) |
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
| **AppSettings** | DB-configurable momentum engine parameters |

---

## API Routes (30+ Endpoints)

### Existing (Volume Engine)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dashboard` | GET | Full dashboard data + momentum summary + convergence |
| `/api/scan` | GET | Run volume scan (dry or live) |
| `/api/scan/scheduled` | GET | Scheduled scan (token-auth, market filter) |
| `/api/trades` | POST | Create trade (supports signalSource, signalScore, signalGrade) |
| `/api/trades/[id]` | PATCH | Close/update a trade |
| `/api/stops/[id]` | PATCH | Mark stop as actioned |
| `/api/balance` | PATCH | Update balance |
| `/api/positions/sync-all` | POST | Sync all positions |
| `/api/positions/[id]/sync` | POST | Sync one position |
| `/api/settings` | GET/PUT | System settings |
| `/api/settings/danger` | POST | Danger zone ops |
| `/api/t212/*` | Various | T212 integration (test, sync, stops, import) |
| `/api/export/*` | GET | CSV/JSON exports |
| `/api/backup` | GET/POST | Backup management |

### Momentum Engine

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/momentum/scan` | POST | Run momentum scan (dashboard-auth) |
| `/api/momentum/sectors` | GET | Latest sector rankings |
| `/api/momentum/signals` | GET | Signals with filters (?status, ?minGrade, ?sectors) |

### Shared Infrastructure

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/alerts` | GET/POST/PATCH | Alert management (list, trigger, acknowledge) |
| `/api/watchlist` | GET/POST/DELETE | Watchlist CRUD |
| `/api/settings/telegram` | GET/POST | Telegram notification config |
| `/api/settings/momentum` | GET/POST | Momentum engine parameters (DB-configurable) |
| `/api/account/size` | GET | Position sizing calculator |

---

## Frontend Pages

| Page | Route | Purpose |
|------|-------|---------|
| **Dashboard** | `/` | Main view: regime, equity curve, momentum summary, daily instructions, open positions, signal log, scan controls, trade history |
| **Momentum** | `/momentum` | Sector momentum table, breakout signal cards with entry panel, near misses |
| **Watchlist** | `/watchlist` | Ticker watchlist with source badges and CRUD |
| **Settings** | `/settings` | T212, Telegram, momentum engine config, risk params, alerts, backup, danger zone |
| **Login** | `/login` | Dashboard auth (cookie-based) |

### Navigation

```
DASHBOARD | MOMENTUM | WATCHLIST | SETTINGS
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
