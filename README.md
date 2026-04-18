# 🐢 VolumeTurtle

A fully mechanical algorithmic trading system with an autonomous Claude-powered agent. Dual-engine signal detection (volume spikes + momentum breakouts), automated stop management, composite scoring, Trading 212 integration, and AI-driven execution with Telegram control.

## What It Does

- **Volume Spike Detection** — Identifies daily volume ≥ 2.0× the 20-day rolling average
- **Momentum Breakout Engine (HBME)** — Sector rotation + breakout scoring with A/B/C/D grades
- **Price Confirmation** — Requires close in the top 25% of the day's range
- **Mechanical Trailing Stops** — 10-day low, ratchets up only (monotonic rule)
- **Cruise Control** — Intraday stop ratchet daemon, polls every 60 minutes during market hours
- **Market Regime Filter** — 3-layer advisory (QQQ 200MA, VIX, ticker 50MA)
- **Equity Curve Circuit Breaker** — Auto-reduces risk at 10% drawdown, pauses at 20%
- **Composite Scoring** — Ranks signals 0.0–1.0 (grades A/B/C/D)
- **Position Sizing** — Fixed 2% risk per trade, 1.5× ATR stop distance, fractional shares, max 5 open positions
- **Auto-Execution** — Two-phase order queue with cancellation window, 13 pre-flight checks, T212 market orders
- **Autonomous Agent** — Claude-powered hourly cycles: T212 health check, equity curve monitoring, pre-market risk screening, position health flags, plain-English trade explanations via Telegram
- **Agent Control** — Telegram commands (HALT/RESUME/PAUSE/STATUS), Settings UI toggle, halt flag with reason
- **Sunday Auto-Tune** — Agent runs parameter sweep + OOS validation, interprets results, sends APPLY/MONITOR/IGNORE verdict
- **Friday Debrief** — Agent produces weekly performance summary with P&L, win rate, and look-ahead
- **Trading 212 Integration** — Position sync, stop order management, automatic stop pushing
- **Scheduled Automation** — Windows Task Scheduler (LSE 17:30, US 22:00)
- **Backup & Restore** — Auto-backup to local filesystem, JSON/CSV export

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, Tailwind CSS |
| Backend | Next.js API Routes |
| Database | PostgreSQL 15 + Prisma ORM (24 models) |
| Data Source | Yahoo Finance (yahoo-finance2) |
| AI Agent | Anthropic Claude (tool-calling agentic loop) |
| Notifications | Telegram Bot API |
| Language | TypeScript (strict mode) |
| Testing | Jest + ts-jest |
| Logging | pino (structured JSON) |

## Quick Start

**Windows (easiest):**
1. Install [Node.js LTS](https://nodejs.org) and [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Double-click `INSTALL.bat` — it handles everything automatically

**Manual:**
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
npx prisma generate
npx prisma db push

# 5. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

## Daily Use

Double-click `START.bat` — it starts Docker, waits for the database, and launches the dashboard.

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
| `npm run agent` | Run one agent cycle manually |
| `npm run agent:sunday` | Sunday maintenance (snapshot + auto-tune) |
| `npm run agent:friday` | Friday weekly debrief |
| `npm run agent:listen` | Telegram command listener |
| `npm run tune` | Auto-tune with OOS gate |
| `npm run walkforward` | Walk-forward validation |
| `npm run schedule:agent:setup` | Install agent scheduled tasks |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Prisma Studio GUI |

| Batch File | Description |
|------------|-------------|
| `INSTALL.bat` | One-click first-time setup |
| `START.bat` | Daily start (Docker + server + browser) |
| `UNINSTALL.bat` | Remove scheduled tasks + stop database |
| `scan.bat` | Run a nightly scan |
| `package.bat` | Create deployment zip for another PC |

## Project Structure

```
src/
├── app/                # Next.js pages + API routes
│   ├── page.tsx         # Main dashboard
│   ├── components/      # Extracted UI components
│   ├── hooks/           # React hooks (useDashboard)
│   ├── login/           # Auth login page
│   ├── execution/       # Auto-execution pending orders dashboard
│   ├── journal/         # Trade journal with analytics
│   ├── settings/        # Settings page (incl. Agent toggle)
│   ├── momentum/        # Momentum dashboard page
│   ├── watchlist/        # Watchlist page
│   └── api/             # REST endpoints (scans, trades, execution, agent, telegram)
├── agent/               # Autonomous Claude agent
│   ├── prompt.ts        # System prompts (weekday, Sunday, Friday)
│   ├── context.ts       # Market state gatherer
│   ├── tools.ts         # 13 tool definitions + handlers
│   ├── executor.ts      # Claude agentic loop
│   ├── logger.ts        # Decision audit logging
│   ├── runner.ts        # Weekday entry point
│   ├── runner-sunday.ts # Sunday maintenance
│   ├── runner-friday.ts # Friday weekly debrief
│   └── telegram-listener.ts # HALT/RESUME/STATUS
├── lib/
│   ├── signals/         # Volume signal, exit signal, regime filter, composite score
│   ├── risk/            # ATR, position sizing, equity curve, stop ratcheting
│   ├── data/            # Yahoo Finance fetching + caching
│   ├── cruise-control/  # Intraday stop ratchet daemon
│   ├── execution/       # Auto-execution engine (pending orders, pre-flight, scheduler)
│   ├── hbme/            # Momentum/breakout engine + sector scoring
│   ├── t212/            # Trading 212 API client (read + write)
│   ├── trades/          # Trade management utilities
│   ├── universe/        # Ticker universe management
│   ├── logger.ts        # Structured logging (pino)
│   ├── retry.ts         # Exponential backoff retry utility
│   ├── currency.ts      # GBP/USD/EUR ticker currency handling
│   └── config.ts        # Environment configuration + DB overrides
├── db/                  # Prisma client singleton
└── __tests__/           # Unit tests (Jest)
prisma/
└── schema.prisma        # 24 data models (incl. AiSettings, AgentHaltFlag, AgentDecisionLog)
```

## Authentication

Set `DASHBOARD_TOKEN` in `.env` to enable dashboard authentication. When set, all routes require a valid token (cookie or Bearer header). The scheduled scan endpoint uses its own `SCHEDULED_SCAN_TOKEN`. The agent uses `ANTHROPIC_API_KEY` for Claude API access.

## Documentation

See [HOW_TO_RUN.md](HOW_TO_RUN.md) for the step-by-step operational runbook.
See [SYSTEM_BREAKDOWN_2026-04-18.md](SYSTEM_BREAKDOWN_2026-04-18.md) for the full system architecture.
See [SYSTEM_BREAKDOWN.md](SYSTEM_BREAKDOWN.md) for the original signal engine documentation.

## Disclaimer

**This software is provided for educational and informational purposes only.** The author is not a financial adviser. Nothing in this project constitutes financial advice, investment advice, or a recommendation to buy or sell any security. Trading stocks and other financial instruments involves risk, including the potential loss of your entire investment. Past performance — whether simulated or real — does not guarantee future results. **Use this software entirely at your own risk.** Always do your own research and consult a qualified financial adviser before making investment decisions.
