# 🐢 VolumeTurtle

A fully mechanical volume-spike trading system. Algorithm-driven position entry, trailing stop management, and risk controls — no discretionary overrides.

## What It Does

- **Volume Spike Detection** — Identifies daily volume ≥ 2.0× the 20-day rolling average
- **Price Confirmation** — Requires close in the top 25% of the day's range
- **Mechanical Trailing Stops** — 10-day low, ratchets up only
- **Market Regime Filter** — 3-layer advisory (QQQ 200MA, VIX, ticker 50MA)
- **Equity Curve Circuit Breaker** — Auto-reduces risk at 10% drawdown, pauses at 20%
- **Composite Scoring** — Ranks signals 0.0–1.0 (grades A/B/C/D)
- **Position Sizing** — Fixed 2% risk per trade, fractional shares, max 5 open positions
- **Trading 212 Integration** — Read-only position sync, stop order mapping
- **Scheduled Automation** — Windows Task Scheduler (LSE 17:30, US 22:00)
- **Backup & Restore** — Auto-backup to local filesystem, JSON/CSV export

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, Tailwind CSS |
| Backend | Next.js API Routes |
| Database | PostgreSQL 15 + Prisma ORM |
| Data Source | Yahoo Finance (yahoo-finance2) |
| Language | TypeScript (strict mode) |
| Testing | Jest + ts-jest |
| Logging | pino (structured JSON) |

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd volume-turtle
npm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, balance, and optionally DASHBOARD_TOKEN

# 4. Set up database
npm run db:push
npm run db:generate

# 5. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

## Key Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npm run scan` | Run full nightly scan |
| `npm run scan:dry` | Preview-only scan (no DB writes) |
| `npm run validate` | Validate ticker universe against Yahoo |
| `npm run backup` | Manual database backup |
| `npm run restore` | Restore from JSON backup |
| `npm run db:studio` | Open Prisma Studio GUI |

## Project Structure

```
src/
├── app/               # Next.js pages + API routes
│   ├── page.tsx        # Main dashboard
│   ├── components/     # Extracted UI components
│   ├── login/          # Auth login page
│   ├── settings/       # Settings page
│   └── api/            # 18 REST endpoints
├── lib/
│   ├── signals/        # Volume signal, exit signal, regime filter, composite score
│   ├── risk/           # ATR, position sizing, equity curve circuit breaker
│   ├── data/           # Yahoo Finance fetching + caching
│   ├── universe/       # Ticker universe management
│   ├── t212/           # Trading 212 integration
│   ├── logger.ts       # Structured logging (pino)
│   ├── retry.ts        # Exponential backoff retry utility
│   └── config.ts       # Environment configuration + validation
├── db/                 # Prisma client singleton
└── __tests__/          # Unit tests (Jest)
prisma/
└── schema.prisma       # 11 data models
```

## Authentication

Set `DASHBOARD_TOKEN` in `.env` to enable dashboard authentication. When set, all routes require a valid token (cookie or Bearer header). The scheduled scan endpoint uses its own `SCHEDULED_SCAN_TOKEN`.

## Documentation

See [SYSTEM_BREAKDOWN.md](SYSTEM_BREAKDOWN.md) for comprehensive system documentation including signal engine, risk management, API reference, and design decisions.
