# VolumeTurtle — Copilot Instructions

## Project Overview

Algorithmic trading system: volume-spike detection, mechanical trailing stops, composite scoring, and Trading 212 integration. Next.js 14 + TypeScript strict + PostgreSQL + Prisma.

## Quick Reference

| Action | Command |
|--------|---------|
| Dev server | `npm run dev` or double-click `START.bat` |
| First-time setup | Double-click `INSTALL.bat` |
| Run tests | `npm test` |
| Run scan | `npm run scan` (full) or `npm run scan:dry` (preview) |
| DB push schema | `npm run db:push` |
| DB studio | `npm run db:studio` |
| Backup | `npm run backup` |

## Architecture

```
src/
├── app/                # Next.js pages + API routes
│   ├── api/            # ~20 REST endpoints
│   └── components/     # Dashboard UI components
├── lib/
│   ├── signals/        # Volume signal, exit signal, regime filter, composite score
│   ├── risk/           # ATR, position sizing, equity curve, stop ratcheting
│   ├── data/           # Yahoo Finance fetching + DB caching
│   ├── cruise-control/ # Intraday stop ratchet daemon
│   ├── t212/           # Trading 212 API client
│   ├── hbme/           # Momentum/breakout engine
│   └── config.ts       # Env-driven config with DB overrides
├── db/client.ts        # Prisma singleton (globalThis pattern)
└── __tests__/          # Jest unit tests
prisma/schema.prisma    # All data models
```

Detailed system docs: [SYSTEM_BREAKDOWN.md](SYSTEM_BREAKDOWN.md)

## Sacred Files — Do Not Modify

These core engine files are frozen. Extend functionality via new modules, never by editing these:

- `src/lib/signals/regimeFilter.ts` — Market regime detection
- `src/lib/signals/compositeScore.ts` — Signal scoring (A/B/C/D grades)
- `src/lib/risk/positionSizer.ts` — Position sizing logic
- `src/lib/risk/ratchetStops.ts` — Nightly stop ratchet engine
- `src/lib/hbme/scanHelpers.ts` — Scan engine helpers
- `src/lib/hbme/breakoutEngine.ts` — Momentum breakout detection

## Coding Conventions

### TypeScript
- **Strict mode** with `noUncheckedIndexedAccess: true`
- Always use `@/` path alias for imports (maps to `src/`)
- Never use `any` — use `unknown` with narrowing

### API Routes
Every route follows this pattern:
```typescript
import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;
  // ... logic ...
  return NextResponse.json(data);
}
```
- Rate limit check **first** in every handler
- Return `NextResponse.json(data)` or `NextResponse.json({ error }, { status })`
- Use `createLogger("module-name")` from `@/lib/logger` for structured logging

### Prisma Access
The generated Prisma client uses `import.meta` which conflicts with some tooling. The codebase uses a typed cast pattern:
```typescript
import { prisma } from "@/db/client";
const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<Array<{ id: string; ticker: string; ... }>>;
  };
};
```
Define only the fields/methods you need in that file.

### Config
All config comes from env vars with fallbacks via `envFloat()` / `envInt()` / `envBool()` in `src/lib/config.ts`. DB overrides via `AppSettings` model.

### Currency
- Ticker suffix determines currency: `.L` = £ (GBP), `.AS`/`.HE` = € (EUR), no suffix = $ (USD)
- LSE prices from Yahoo arrive in pence (GBX) — divide by 100 for GBP
- Use `tickerCurrency(ticker)` in UI, `getCurrencySymbol(ticker)` in lib code

### T212 Integration
- HTTP Basic Auth with `base64(apiKey:apiSecret)`
- Rate limits: respect `x-ratelimit-reset` header, retry on 429
- Stop update flow: cancel existing order → wait 2.5s → place new order
- T212 stop is always a **floor** — never push a lower stop to T212
- Use `getCachedT212Positions()` (1-min cache) to avoid rate limit blanking

## Testing

- Framework: Jest + ts-jest
- Location: `src/__tests__/lib/**/*.test.ts`
- Mock config: `src/__tests__/__mocks__/config.ts` — always mock via `jest.mock("@/lib/config", ...)`
- Test helpers: `generateQuotes(n)` and `makeQuote({...})` in `src/__tests__/helpers.ts`
- Run before marking any task complete: `npm test`

## Common Pitfalls

- **Prisma `{ increment: N }`** does not work through the `as unknown as` cast. Read current value and add manually.
- **`goto` labels inside `if (...)` blocks** in batch files silently exit the script. Use `if not errorlevel 1 goto label` instead.
- **HMR resets module-level state** — use `globalThis` for singletons that must survive Next.js hot reload (see `db/client.ts` pattern).
- **T212 ticker mapping**: T212 internal tickers (e.g. `PMOl_EQ`) differ from Yahoo tickers (e.g. `HBR.L`). Always map through `getInstruments()`.
- **Dev server port conflicts**: Kill stale `node.exe` before starting. `START.bat` handles this automatically.

## Task Management

- Plan: `tasks/todo.md`
- Lessons: `tasks/lessons.md` — update after any correction
