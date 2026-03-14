# VolumeTurtle — Complete System Breakdown

> Fully mechanical volume-spike trading system.
> Scan → Signal → Size → Manage. No human judgment in signal generation.

---

## Architecture

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 14, React 18, Tailwind CSS |
| **Backend** | Next.js API Routes (14 endpoints) |
| **Database** | PostgreSQL via Prisma ORM |
| **Data Source** | Yahoo Finance (`yahoo-finance2`) |
| **Broker** | Trading 212 API (read-only) |
| **Scheduling** | Windows Task Scheduler (17:30 LSE, 22:00 US) |
| **Language** | TypeScript (strict mode) |

---

## Signal Engine

### Entry Signal (Two-Part Confirmation)

Both conditions must be true for a signal to fire:

| Condition | Formula | Default |
|-----------|---------|---------|
| **Volume Spike** | `today.volume ≥ multiplier × avg_volume_20` | 2.0× |
| **Price Confirmation** | `(close - low) / (high - low) ≥ threshold` | 0.75 |

- Average volume uses the previous 20 bars (excludes today)
- Range position confirms the close is in the **top 25%** of the day's range
- If volume spikes but price closes weak → no signal

### Exit Logic (Trailing Stop)

| Parameter | Formula | Default |
|-----------|---------|---------|
| **Hard Stop** | `entry - (ATR20 × multiplier)` | 2.0× ATR |
| **Trailing Stop** | Lowest close over last N days | 10 days |

- Trailing stop **ratchets up only** — never moves down
- Exit triggers when `close < min(hardStop, trailingStop)`
- R-multiple calculated on exit: `(exitPrice - entryPrice) / riskPerShare`

### ATR Calculation

- Uses **Wilder's smoothing** over 20 periods
- `TR = max(H-L, |H-prevClose|, |L-prevClose|)`
- Initial ATR = SMA of first 20 true ranges
- Subsequent: `ATR = (prevATR × 19 + TR) / 20`

---

## Regime Filter (Advisory)

Three-layer filter that gates whether a signal is actionable based on market conditions.
**Purely advisory** — never blocks trades, only warns. Human retains final decision.

### Layer 1 — Market Regime (QQQ Trend)

| Condition | Result |
|-----------|--------|
| QQQ close ≥ 200-day SMA | **BULLISH** |
| QQQ close < 200-day SMA | **BEARISH** |

QQQ is used as the benchmark (better proxy for the tech/AI/crypto-heavy universe than SPY).
Fetched with 280-day lookback to calculate the 200-day SMA.

### Layer 2 — Volatility Regime (VIX)

| VIX Level | Result |
|-----------|--------|
| < 25 | **NORMAL** |
| 25–35 | **ELEVATED** — increased false signal risk |
| > 35 | **PANIC** — high false signal risk |

### Layer 3 — Ticker Trend (50-day MA)

| Condition | Result |
|-----------|--------|
| Ticker close ≥ 50-day SMA | **UPTREND** — signal valid |
| Ticker close < 50-day SMA | **DOWNTREND** — signal flagged |
| < 50 days of data | **INSUFFICIENT_DATA** |

### Overall Assessment

| Score | Layers Green | Assessment | Signal Card Border |
|-------|-------------|------------|-------------------|
| 3 | All three | **STRONG** | Green |
| 2 | Two of three | **CAUTION** | Amber |
| 0–1 | One or none | **AVOID** | Red |

### Implementation

- Market regime (QQQ + VIX) calculated **once per scan** — not per ticker
- Ticker trend calculated per signal
- Regime state stored in `ScanRun` table (`marketRegime`, `vixLevel`, `qqqVs200MA`)
- `RegimeAssessment` attached to each `VolumeSignal`
- Dashboard shows persistent **Regime Banner** below header with QQQ/VIX status
- Signal cards show full regime breakdown with colour-coded warnings
- Scan history table includes REGIME column

---

## Equity Curve Circuit Breaker

Automatically reduces risk when the account is in a drawdown and restores it when conditions improve.

### System States

| State | Trigger | Risk/Trade | Max Positions | Effect |
|-------|---------|-----------|--------------|--------|
| **NORMAL** | Drawdown < 10% AND above equity MA20 | 2.0% | 5 | Full operation |
| **CAUTION** | Drawdown ≥ 10% OR below equity MA20 | 1.0% | 3 | Reduced risk |
| **PAUSE** | Drawdown ≥ 20% | 0% | 0 | No new entries, exits only |

### Drawdown Tracking

- **Peak balance** = highest `AccountSnapshot.balance` ever recorded
- **Drawdown %** = `(peak - current) / peak × 100`
- **Equity MA20** = 20-period SMA of daily balances (needs ≥ 5 snapshots)

### Recovery Logic

Recovery requires the qualifying condition to hold for **3 consecutive AccountSnapshots**:
- PAUSE → CAUTION: drawdown drops below 20%
- CAUTION → NORMAL: drawdown drops below 10% AND balance above equity MA20

### Dashboard

- **NORMAL**: single-line summary (balance, peak, drawdown, sparkline)
- **CAUTION**: amber-bordered panel with reduced risk details and recovery conditions
- **PAUSE**: red-bordered panel, no new entries, recovery amount shown
- **Sparkline**: SVG chart of last 30 snapshots with peak line and MA20 line

### Signal Card

Each signal card shows system state:
- NORMAL: "✅ NORMAL — full 2% risk active"
- CAUTION: shows reduced shares/exposure, drawdown details
- PAUSE: "MARK AS PLACED" button disabled, shows recovery requirement

### Key Principle

Existing open trades are **never affected** — stops and exits continue normally.
Only new position sizing and entry decisions are gated by the circuit breaker.

---

## Risk Management

| Parameter | Default | Env Variable |
|-----------|---------|-------------|
| Risk per trade | **2%** of account | `RISK_PER_TRADE_PCT` |
| Max open positions | **5** | `MAX_POSITIONS` |
| Max exposure warning | **25%** per position | Hardcoded |
| Account balance | **£1,000** | `VOLUME_TURTLE_BALANCE` |

### Position Sizing Formula

```
dollarRisk   = balance × riskPctPerTrade
riskPerShare = entryPrice - hardStop
shares       = dollarRisk / riskPerShare
```

- Fractional shares supported (Trading 212)
- Position rejected if total exposure < £1
- Exposure warning triggered if single position > 25% of account

---

## Universe

**~269 unique tickers** across 22 sectors (duplicates removed via `getUniverse()`):

| Sector | Examples | Count |
|--------|----------|-------|
| AI / High Beta Tech | SOUN, BBAI, CRWV, ALAB, AI | 20 |
| Quantum Computing | QBTS, IONQ, RGTI, QUBT | 6 |
| Space / Deep Tech | RKLB, ASTS, LUNR, RDW | 8 |
| Robotics / Autonomy | JOBY, ACHR, EVTL, BLBD | 6 |
| Crypto / Bitcoin Proxies | MSTR, RIOT, CLSK, MARA, COIN | 14 |
| Nuclear / Energy Transition | OKLO, NNE, SMR, UEC, CCJ | 11 |
| Clean Energy / Solar / EV | RUN, PLUG, FSLR, RIVN, LCID | 13 |
| Biotech / Clinical Stage | CRSP, BEAM, NTLA, MRNA, BNTX | 25 |
| Commodity / Resource Plays | AG, PAAS, HL, MP, FCX, VALE | 20 |
| High Beta Fintech | SOFI, UPST, CVNA, DKNG, ROKU | 15 |
| UK High Beta (LSE) | ANTO.L, FRES.L, GLEN.L, BHP.L | 20 |
| European High Beta | ASML, BESI.AS, NESTE.HE, STM | 9 |
| Turnaround / Distressed | PTON, BYND, WRBY, LMND | 12 |
| Defence & Geopolitical | KTOS, PLTR, DRS, CACI, AVAV | 9 |
| Healthcare High Beta | CGON, VKTX, ALNY, HALO, INSM | 18 |
| Nuclear & Energy Commodities | SMR, NNE, LEU, GEV, VST, CEG | 11 |
| UK LSE (Active) | QQ.L, RR.L, IMI.L, GAW.L | 14 |
| Crypto ETFs & Proxies | BITO, IBIT, GBTC, MSTU | 6 |
| AI Infrastructure & Semis | CIEN, COHR, ACLS, ONTO, CAMT | 10 |
| Commodities & Materials | ATEX, ABAT, MTH, KBH, PHM | 7 |
| Fintech & Payments | AFRM, FLYW, RPAY, PRAA | 10 |
| Narrative / Meme Adjacent | BBBY, IMPP, AEYE, GEVI | 7 |

### Market Filtering

```typescript
type MarketFilter = "LSE" | "US" | "EU" | "ALL"
```

| Filter | Matches |
|--------|---------|
| `LSE` | Tickers ending in `.L` |
| `EU` | Tickers ending in `.AS`, `.ST`, `.HE`, `.CO` |
| `US` | All tickers without non-US suffixes |
| `ALL` | Full universe |

### Liquidity Filter

| Market | Min Avg Daily Dollar Volume |
|--------|---------------------------|
| US tickers | $1,000,000 |
| Non-US tickers (.L, .AS, .ST, .HE, .CO) | $500,000 |

Calculated from last 20 bars: `avg(close × volume)`

---

## Nightly Scan Flow

```
1. Load account balance (DB snapshot or env var)
2. Calculate market regime (QQQ 200MA + VIX)
3. Fetch 60 days OHLCV for universe (Yahoo Finance)
   ├─ Batched: 10 tickers per batch
   ├─ 500ms delay between batches
   └─ Skip tickers with < 25 days of data
4. Filter by liquidity threshold
5. Generate signals (volume spike + price confirmation + regime assessment)
6. Sort signals by volumeRatio descending (strongest first)
7. Check open positions < maxPositions (5)
8. Enter new trades → write to DB
9. Process exits on open trades
   ├─ Hard stop check
   ├─ Trailing stop check
   └─ Update trailing stop (ratchet up)
10. Write StopHistory records
11. Save AccountSnapshot
12. Log ScanRun (trigger, market, duration, regime)
```

### Scan Modes

| Mode | Trigger | DB Writes | Usage |
|------|---------|-----------|-------|
| **Dry Run** | Manual (dashboard) | No | Preview signals |
| **Live Scan** | Manual (dashboard) | Yes | Requires confirmation |
| **Scheduled** | Windows Task Scheduler | Yes | Automatic daily |

---

## Scheduled Scans

| Schedule | Time | Market | Purpose |
|----------|------|--------|---------|
| LSE Scan | **17:30** daily | `.L` tickers only | After London close |
| US Scan | **22:00** daily | US tickers only | After US close |
| App Startup | On login | — | Ensures app is running |

### Setup

```bash
# Add to .env
SCHEDULED_SCAN_TOKEN=your-secret-token-here

# Create Windows scheduled tasks (run as Administrator)
npm run schedule:setup

# Check status
npm run schedule:status

# Remove schedules
npm run schedule:remove
```

### API Endpoint

```
GET /api/scan/scheduled?market=LSE|US&token=SECRET
```

- Token-authenticated (prevents external triggers)
- Logs to ScanRun table with `trigger: "SCHEDULED"`
- Returns JSON summary

### Missed Scan Detection

The dashboard detects missed scans by checking if a ScanRun record
exists for today's expected window. Shows red "missed" indicator
in the header if the scan didn't fire.

---

## Database Schema (PostgreSQL)

### 11 Models

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| **Ticker** | Universe of scanned symbols | `symbol` (unique), `active`, `sector` |
| **DailyQuote** | OHLCV bars from Yahoo | `tickerId`, `date`, OHLC, `volume` (BigInt) |
| **Signal** | Generated volume spike signals | `tickerId`, `date`, `type`, `strength` (0–1) |
| **RiskCalc** | Position sizing calc | `signalId`, `entryPrice`, `stopPrice`, `positionSize` |
| **ScanRun** | Scan run metadata | `status`, `trigger`, `market`, `durationMs`, `signalsFound`, `marketRegime`, `vixLevel`, `qqqVs200MA` |
| **Trade** | Open/closed trades | `ticker`, entry/exit, stops, `rMultiple`, `status` |
| **StopHistory** | Daily stop level per trade | `stopLevel`, `stopType`, `changed`, `actioned` |
| **ScanResult** | Per-ticker scan result | `ticker`, `scanDate`, `signalFired`, `actionTaken` |
| **AccountSnapshot** | Daily balance snapshot | `date`, `balance`, `openTrades` |
| **Settings** | Key-value config store | `key` (unique), `value` |
| **T212Connection** | Trading 212 credentials | `environment`, `apiKey`, `accountType`, `connected` |

---

## API Routes (14 Endpoints)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dashboard` | GET | Full dashboard data: balance, trades, signals, instructions, schedule status, scan history, regime |
| `/api/scan` | GET | Run scan (`?dry=true\|false`) — signals, near misses, entries, exits |
| `/api/scan/scheduled` | GET | Scheduled scan (`?market=LSE\|US&token=SECRET`) |
| `/api/trades` | POST | Create a new trade |
| `/api/trades/[id]` | PATCH | Close/update a trade |
| `/api/stops/[id]` | PATCH | Mark a stop as actioned on T212 |
| `/api/balance` | PATCH | Update account balance snapshot |
| `/api/positions/sync-all` | POST | Sync all positions — update stops, check exits, fetch T212 |
| `/api/positions/[id]/sync` | POST | Sync a single position |
| `/api/settings` | GET/POST | Read/write system settings |
| `/api/settings/danger` | POST | Danger zone operations (clear trades/signals/stops) |
| `/api/t212/test` | POST | Test Trading 212 connection |
| `/api/t212/positions` | GET | Fetch live T212 positions |
| `/api/t212/sync` | POST | Sync T212 data |

### Dashboard Response Structure

```typescript
{
  account: AccountSnapshot | null
  openTrades: Trade[]           // with stopHistory
  recentSignals: ScanResult[]   // last 14 days
  closedTrades: Trade[]         // last 60 days
  lastScanTime: string | null
  actions: ActionItem[]         // EXIT → STOP_UPDATE → HOLD
  instructions: Instruction[]   // daily trader instructions
  scheduledScans: {
    lse: { nextRun, lastRun, lastRunSignals, missed }
    us:  { nextRun, lastRun, lastRunSignals, missed }
  }
  regime: RegimeData | null     // QQQ/VIX market regime
  scanHistory: ScanHistoryEntry[]  // last 20 scans (with regime)
}
```

---

## Trading 212 Integration

**Read-only** — no order placement. Uses basic auth.

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getAccountCash()` | `/equity/account/cash` | Cash, total, P&L |
| `getOpenPositions()` | `/equity/portfolio` | Live positions with stops |
| `getPendingOrders()` | `/equity/orders` | Pending orders (stop orders) |
| `getInstruments()` | `/equity/metadata/instruments` | All T212 instrument metadata |
| `getPositionsWithStopsMapped()` | — | Maps T212 tickers → Yahoo, converts GBX → GBP |
| `testConnection()` | — | Validates API credentials |

### Ticker Mapping

T212 uses internal tickers (e.g. `PMOl_EQ`). These are mapped to Yahoo format
using the instruments API:

```
T212: PMOl_EQ (shortName: HBR, currencyCode: GBX) → Yahoo: HBR.L
T212: AAPL_US_EQ (shortName: AAPL, currencyCode: USD) → Yahoo: AAPL
```

Instruments are cached per session.

---

## Currency Handling

| Suffix | Currency | Symbol | Conversion |
|--------|----------|--------|------------|
| `.L` | GBP | £ | Yahoo & T212 return **pence** → ÷100 |
| `.AS`, `.HE` | EUR | € | None |
| `.ST`, `.CO` | SEK/DKK | kr | None |
| *(default)* | USD | $ | None |

- No cross-currency FX conversion — each position works in its native currency
- Pence conversion applied at both Yahoo ingestion and T212 position sync
- Volume is unaffected (shares, not currency)

---

## Frontend Dashboard

**Dark theme** — JetBrains Mono / Fira Code, built with Next.js + Tailwind.

### Sections

| Section | Description |
|---------|-------------|
| **Header** | Balance (editable), open positions, exposure %, last scan, schedule status (LSE/US countdowns), sync button |
| **Regime Banner** | Persistent QQQ/VIX status: BULLISH/BEARISH, NORMAL/ELEVATED/PANIC, overall assessment (FAVOURABLE/CAUTION/HOSTILE) with colour-coded background |
| **Equity Curve** | System state panel: NORMAL (one-line), CAUTION (amber, reduced risk details), PAUSE (red, no entries). SVG sparkline of last 30 snapshots |
| **Action Required** | EXIT (red) / STOP_UPDATE (amber) / NEW_SIGNAL alerts |
| **Daily Instructions** | Per-trade instructions: HOLD / UPDATE_STOP / EXIT with specific prices and actions |
| **Open Positions** | Table with entry, current price, stops, T212 stop comparison, P&L, sync button, mark exited |
| **Signal Log + Scan Panel** | Two-column: recent signals (14 days) and scan controls (dry run / live scan with confirmation modal) |
| **Signal Cards** | Entry, stop, shares, exposure %, volume ratio bar, range position bar, regime assessment (3 layers + overall), system state (NORMAL/CAUTION/PAUSE) |
| **Trade History** | Closed trades with R-multiple, win rate, avg R |
| **Scan History** | Collapsible table: date, time, market, regime, signals, tickers scanned, trigger (SCHEDULED/MANUAL), duration, status |

### Design System

| Element | Value |
|---------|-------|
| Background | `#0a0a0a`, `#111` |
| Card | `var(--card)` |
| Green | `var(--green)` — signals, wins, confirmations |
| Red | `var(--red)` — exits, stops, losses |
| Amber | `var(--amber)` — warnings, stop updates |
| Dim | `var(--dim)` — secondary text |
| Font | JetBrains Mono, Fira Code, monospace |

---

## Configuration

All settings configurable via environment variables:

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `DATABASE_URL` | string | required | PostgreSQL connection |
| `VOLUME_TURTLE_BALANCE` | float | 1000 | Account balance |
| `MAX_POSITIONS` | int | 5 | Max open positions |
| `RISK_PER_TRADE_PCT` | float | 2 | Risk % per trade |
| `VOLUME_SPIKE_MULTIPLIER` | float | 2.0 | Volume spike threshold |
| `RANGE_POSITION_THRESHOLD` | float | 0.75 | Close range position threshold |
| `ATR_PERIOD` | int | 20 | ATR calculation period |
| `TRAILING_STOP_DAYS` | int | 10 | Trailing stop lookback |
| `HARD_STOP_ATR_MULTIPLE` | float | 2.0 | Hard stop ATR multiplier |
| `SCHEDULED_SCAN_TOKEN` | string | — | Auth token for scheduled scans |
| `T212_API_KEY` | string | — | Trading 212 API key |
| `T212_API_SECRET` | string | — | Trading 212 API secret |
| `T212_ENVIRONMENT` | string | demo | `demo` or `live` |
| `T212_ACCOUNT_TYPE` | string | isa | `invest`, `isa`, or `both` |

---

## npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `next dev` | Development server |
| `build` | `prisma generate && next build` | Production build |
| `start` | `next start` | Production server |
| `lint` | `next lint` | ESLint |
| `db:generate` | `prisma generate` | Regenerate Prisma client |
| `db:migrate` | `prisma migrate dev` | Run migrations |
| `db:push` | `prisma db push` | Push schema to DB |
| `db:studio` | `prisma studio` | Prisma Studio GUI |
| `scan` | `tsx scripts/nightlyScan.ts` | Run nightly scan |
| `scan:dry` | `tsx scripts/nightlyScan.ts --dry-run` | Dry-run scan |
| `validate` | `tsx scripts/validateUniverse.ts` | Validate tickers against Yahoo |
| `schedule:setup` | `setupScheduler.bat` | Create Windows scheduled tasks |
| `schedule:remove` | `schtasks /delete ...` | Remove scheduled tasks |
| `schedule:status` | `schtasks /query ...` | Check task status |

---

## File Structure

```
volume-turtle/
├── prisma/
│   └── schema.prisma              # Database schema (11 models)
├── scripts/
│   ├── nightlyScan.ts             # Core nightly scan script
│   ├── validateUniverse.ts        # Ticker validation against Yahoo
│   ├── setupScheduler.bat         # Windows Task Scheduler setup
│   ├── start.bat                  # App startup script
│   └── checkTrades.ts             # Trade checking utility
├── src/
│   ├── app/
│   │   ├── page.tsx               # Dashboard frontend
│   │   ├── layout.tsx             # App layout
│   │   ├── globals.css            # Global styles + CSS variables
│   │   ├── settings/
│   │   │   └── page.tsx           # Settings page (T212, risk params, danger zone)
│   │   └── api/
│   │       ├── dashboard/route.ts # Dashboard data endpoint
│   │       ├── scan/
│   │       │   ├── route.ts       # Manual scan endpoint
│   │       │   └── scheduled/route.ts  # Scheduled scan endpoint
│   │       ├── trades/route.ts    # Create trade
│   │       ├── trades/[id]/route.ts    # Update/close trade
│   │       ├── stops/[id]/route.ts     # Mark stop as actioned
│   │       ├── balance/route.ts   # Update balance
│   │       ├── positions/
│   │       │   ├── sync-all/route.ts   # Sync all positions
│   │       │   └── [id]/sync/route.ts  # Sync single position
│   │       ├── settings/
│   │       │   ├── route.ts       # Read/write settings
│   │       │   └── danger/route.ts     # Danger zone operations
│   │       └── t212/
│   │           ├── test/route.ts  # Test T212 connection
│   │           ├── positions/route.ts  # Fetch T212 positions
│   │           └── sync/route.ts  # Sync T212 data
│   ├── db/
│   │   └── client.ts              # Prisma client singleton
│   └── lib/
│       ├── config.ts              # Configuration (env vars + defaults)
│       ├── currency.ts            # Currency symbol mapping
│       ├── data/
│       │   ├── yahoo.ts           # Yahoo Finance wrapper
│       │   ├── fetchQuotes.ts     # Batch OHLCV fetcher (pence conversion)
│       │   └── index.ts           # Data exports
│       ├── risk/
│       │   ├── atr.ts             # ATR calculation (Wilder's smoothing)
│       │   ├── positionSizer.ts   # Position size calculator
│       │   ├── equityCurve.ts     # Equity curve circuit breaker
│       │   └── index.ts           # Risk exports
│       ├── signals/
│       │   ├── volumeSignal.ts    # Volume spike signal generator
│       │   ├── exitSignal.ts      # Trailing stop / exit logic
│       │   ├── regimeFilter.ts    # Three-layer regime filter (QQQ, VIX, ticker MA)
│       │   └── index.ts           # Signal exports
│       ├── t212/
│       │   └── client.ts          # Trading 212 API client
│       └── universe/
│           ├── tickers.ts         # Ticker universe + market filter + liquidity
│           ├── manager.ts         # Universe CRUD (add/remove tickers)
│           └── index.ts           # Universe exports
├── .env.example                   # Environment variable template
├── package.json                   # Dependencies and scripts
├── docker-compose.yml             # PostgreSQL container
└── tailwind.config.ts             # Tailwind configuration
```

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Bradliebs/VolumeTurtle.git
cd VolumeTurtle/volume-turtle
npm install

# 2. Start PostgreSQL
docker-compose up -d

# 3. Configure
cp .env.example .env
# Edit .env with your settings

# 4. Setup database
npm run db:push
npm run db:generate

# 5. Validate universe
npm run validate

# 6. Run
npm run dev          # Development
npm run build        # Production build
npm run start        # Production server

# 7. Schedule scans (optional, run as Administrator)
npm run schedule:setup
```

---

## Key Design Decisions

1. **Mechanical only** — No discretionary overrides in signal generation. System fires, you decide whether to act.
2. **Two-part confirmation** — Volume spike alone is not enough. Price must close strong.
3. **Fixed risk** — 2% per trade, always. No scaling up on "conviction".
4. **Trailing stops ratchet up** — Once a stop moves up, it never comes back down.
5. **Read-only broker integration** — T212 is display-only. No automated order placement.
6. **Market-specific scheduling** — LSE and US scanned separately at their respective close times.
7. **Pence normalisation** — All LSE prices stored and displayed in pounds, not pence.
8. **Fractional shares** — Position sizer outputs fractional quantities for T212 compatibility.
9. **Advisory regime filter** — Three-layer market/volatility/trend filter warns but never blocks. Human always decides.
10. **Equity curve circuit breaker** — Automatic risk reduction at 10% drawdown, full pause at 20%. Recovery requires 3 consecutive qualifying snapshots.

---

*Generated: 14 March 2026*
