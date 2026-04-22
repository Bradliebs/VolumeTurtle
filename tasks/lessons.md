# Lessons Learned

## Dev Server
- Next.js "missing required error components" = browser opened before server is ready, or stale node process holding the port. Fix: kill node, clean .next + webpack cache, wait for 200, then open browser.
- Always kill old node.exe before starting dev server — port conflicts cause cascading failures.
- Multiple simultaneous dev servers corrupt webpack HMR state → 404 after initial 200.

## T212 API
- T212 rate limits are strict: stop orders = 1 req/2s, pending orders = 1 req/5s. Always add delays between sequential calls.
- `t212Fetch` must retry on 429 with exponential backoff using `x-ratelimit-reset` header.
- The stop push flow (getPositions + getPendingOrders + cancelOrder + placeStopOrder) is 4+ calls — needs ~3s delay between lookup and order operations.
- Stop push routes must not do duplicate hot-path `/equity/orders` reads before calling `updateStopOnT212()`. `GET /equity/orders` is `1 req / 5s`; two immediate reads can trigger false-looking 429s even for single stop updates.
- In-memory endpoint pacing only protects a single process. If API routes and cruise-control daemon run concurrently, coordinate T212 pacing through shared storage (e.g. `Settings` compare-and-set throttle keys) to avoid cross-process 429 collisions.
- When T212 stop is already at or above the requested level, return success (no-op) instead of an error — the user doesn't need to know it was a no-op.
- System stops and T212 stops are two separate data sources — they can drift apart. T212 may be higher if the user manually raised it. Always treat T212's stop as a floor: if T212 > system, pull system up. Never instruct the user to lower a T212 stop.
- The T212 portfolio table and daily instructions must use the SAME stop source for tracked positions (database trade stops, not fresh market calculations).
- **CRITICAL**: Never auto-close a trade in the DB without checking T212 positions first. The scan routes were auto-closing on trailing stop breach without T212 verification, causing trades to show as CLOSED while the user still held the position. Always use `getCachedT212Positions()` and skip auto-close if T212 confirms position is still held.

## Prisma / Database
- `prisma generate` only updates TypeScript types — it does NOT create or alter database tables. Always run `npm run db:push` (or `npx prisma db push`) after editing `prisma/schema.prisma`.
- Verify new tables exist with `npx prisma studio` before marking schema work complete.
- **`db push` skips client regen when DB is already in sync**: If you add a model to `schema.prisma` but the table was already created out-of-band (or by an earlier push that ran before the cast was wired up), `npm run db:push` reports "already in sync" and does NOT regenerate the client. Symptom: `Cannot read properties of undefined (reading 'findMany')` at runtime on the new model. Fix: always run `npx prisma generate` explicitly after schema edits, regardless of what `db push` reports. Then restart the dev server — HMR doesn't reload `src/generated/prisma`.
- **`findFirst` unreliable in standalone scripts**: With PrismaPg adapter in standalone scripts (nightlyScan.ts), `prisma.accountSnapshot.findFirst()` silently returns null even when rows exist. Use `findMany({ take: 1 })` instead. Also call `prisma.$connect()` explicitly before the first query.
- **Snapshot sanity guard**: Always guard `accountSnapshot.create()` — if the balance equals the config seed (`VOLUME_TURTLE_BALANCE`) and real snapshots already exist, skip the write. Prevents env-var fallback from poisoning the equity curve.
- **Balance drift guard**: Before saving any snapshot, check if the new balance drifted >50% from the last. If so, skip the write and alert via Telegram. Catches any future data corruption vector.
- **Fail-closed on missing snapshots**: If `loadAccountBalance()` finds 0 snapshots but open trades exist, abort the scan instead of using the config seed. Zero snapshots + open trades = broken DB state, not first run.

## CSV / Data Files
- `data/universe.csv` had mixed line endings (CRLF for first ~208 lines, LF for the rest). PapaParse choked on this, treating the rest of the file as extra fields of one row (3811 fields).
- Always normalize line endings when generating or editing CSV files. `loadUniverse()` now strips `\r\n` → `\n` before parsing as a safeguard.
- Don't throw on PapaParse `FieldMismatch` errors — they're non-fatal warnings (e.g. a trailing comma on one row). Only throw on structural errors that prevent data from being parsed.

## Position Sync / Stop Updates
- **CRITICAL**: Exit checks in sync routes must compare price against the PREVIOUS stop (the one active when the bar traded), NOT the newly ratcheted stop. The sync-all and single-sync routes were: (1) calculating new trailing stop, (2) writing it to DB, (3) checking exit against the NEW higher stop → false closes. The scan routes had the correct order: check exit first, then update stop. Fixed 2026-04-06.
- Rule: when ratcheting a stop upward AND checking exits in the same operation, always check exit against `previousStop = max(hardStop, oldTrailingStop)` before the ratchet.

## Agent Subsystem
- **Never hardcode regime state**: `regimeBullish = true` in context.ts bypassed all bear-market protection. Always call `calculateMarketRegime()` live, with a fail-safe to BEARISH if data is unavailable.
- **PAUSE/HALT must reach all consumers**: Setting `autoExecutionEnabled: false` only stops the auto-executor. The agent checks `AgentHaltFlag.halted` — if PAUSE doesn't set the halt flag, the agent ignores it. Always update both.
- **Never silently skip a risk check**: Check 13 (heat cap) was swallowing DB errors and continuing execution. If a safety check can't verify its condition, fail the order — don't skip the check.
- **Race conditions in execution**: Position count check and trade creation must be atomic (use `$transaction`). Two concurrent orders can both pass a non-atomic check and exceed limits. Also: always create the DB trade if T212 accepted the order — losing track of a real position is worse than exceeding a limit.
- **Rate-limit before T212 cancel**: `cancelOrder()` hits the same write endpoint as `placeStopOrder()`. Without pacing, back-to-back cancel+place can trigger 429. If cancel fails, never attempt placement — it would create a duplicate stop.
- **Greedy regex on LLM output**: `[\s\S]*` matches first `[` to last `]` in a response — breaks if Claude returns multiple JSON arrays. Always use non-greedy `[\s\S]*?`.
- **Timeout all external API calls**: Claude API and T212 fetch had no timeouts — a hung endpoint blocks the entire agent process. Use `AbortSignal.timeout()` for T212 (15s) and `AbortController` for Claude (30s).
- **Retry transient errors once**: On 429 or 5xx from Claude, wait 10s and retry once. Two failures = throw. Don't retry forever.
- **Validate auth tokens at module load**: If `DASHBOARD_TOKEN` is empty, log an error immediately rather than letting every internal fetch silently 401.
- **Every route needs rate limiting**: The project convention is rate limit first in every handler. Three routes shipped without it — stops PATCH, telegram send, position sync. Always add `rateLimit(getRateLimitKey(req), N, 60_000)` as the first line.
- **CAUTION regime must reduce position size, not just warn**: Grade A in CAUTION was only adding a warning string. It must apply 50% sizing like the equity curve CAUTION pattern does. Warnings without mechanical effect are bugs.
- **Breadth failure must be fail-safe**: If `calculateBreadth()` throws, treating it as "no breadth data, continue" is the wrong default. Fail-safe = treat as DETERIORATING and block the order. Conservative when blind.
- **Coverage gates need retry + high threshold**: A 10% threshold with no retry meant scans ran on partial data when Yahoo was flaky. 80% threshold with exponential backoff (3 attempts) catches transient failures.

## Critical Engine Guards
- **Never send empty tool_use_id to Claude**: If `toolCall.id` is undefined, skip the tool result entirely. An empty string breaks the agentic loop — Claude can't match results to requests.
- **Batch DB lookups, not N+1**: `getLatestCachedDate(ticker)` inside a loop = 2 queries × N tickers. Use `groupBy` with `_max` to get all latest dates in one query, then look up from a Map.
- **Validate weights after DB override**: `applyDbSettings()` can change composite score weights after startup validation. Re-validate the sum inside `applyDbSettings()` — if they don't sum to ~1.0, reject the weight overrides and log an error.
- **Never set a stop to 0**: `calculate20DayLow()` returns 0 with insufficient candles. Guard: if result is 0 or candles < 5, skip the ratchet and log a warning. A $0 stop = immediate liquidation.
- **Stop must be below current price**: At 3R+ profit with expanded ATR, the R-multiple ladder can compute a stop above the current price. Cap at `currentPrice * 0.99` to prevent unwanted exit.
- **Guard entry === stop**: If `suggestedEntry === suggestedStop`, `riskPerShare = 0` → division by zero → infinite shares. Return null before any sizing math.

## Medium Audit Fixes
- **Don't hardcode model strings**: `check_premarket_risk` had its own model string. Export `DEFAULT_MODEL` from executor.ts and import it everywhere — single source of truth for model changes.
- **Guard division results before passing to sacred files**: `volumeRatio = volume / avgVolume20` can be `Infinity` when `avgVolume20 === 0`. Guard with `Number.isFinite()` before it reaches `compositeScore.ts` (sacred, can't modify).
- **Clean up tracking Maps each cycle**: Ghost/orphan trackers stored entries forever. Prune entries for positions no longer open at the start of each poll to prevent memory growth over days.
- **Return `{ data, error }` from fetch functions**: Returning `[]` for both "no data" and "fetch failed" prevents callers from distinguishing the two. A structured return lets callers log errors vs handle empty data differently.

## Schema & Config Maintenance
- **Add cleanup routes for unbounded tables**: RetryQueue and expired PendingOrder rows accumulate indefinitely without TTL cleanup. Create an internal cleanup endpoint and schedule it daily.
- **Use `Json` type for JSON columns**: `String @db.Text` for JSON data loses DB-level validation and queryability. Use Prisma `Json` type — pass plain objects (not `JSON.stringify`) and PostgreSQL stores as `JSONB`.
- **Validate URLs at startup**: `TRADECORE_BASE_URL` was never validated. Use `new URL()` constructor — if it throws, exit with a clear error. Catches typos like `"htp://localhost"` before the agent runs.
- **Call `applyDbSettings()` before agent context**: The agent's first cycle can run with stale env-var config if DB settings aren't loaded. Call `applyDbSettings()` at the top of `gatherContext()`.
- **Strict `envFloat()` parsing**: `parseFloat("123abc")` silently returns `123`. Use regex `/^-?\d+(\.\d+)?$/` to reject partial numeric strings.
- **Migrate TEXT → JSONB without data loss**: `prisma db push` refuses to change column types when data exists. Use `prisma db execute --stdin` with `ALTER COLUMN ... TYPE JSONB USING "column"::jsonb` to cast in-place.

## API Route Hardening
- **Use `Promise.allSettled()` for non-critical parallel queries**: `Promise.all()` aborts all queries if one fails. `Promise.allSettled()` returns partial results with fallbacks for failures.
- **Validate query params before use**: `Number("abc")` is `NaN`. Always check `Number.isFinite()` and provide a sensible default.
- **Use Zod schemas + `validateBody()` for POST inputs**: The project has `src/lib/validation.ts` with `validateBody()`. Define schemas there, import in routes. Don't cast `as { ... }` without validation.
- **Use proper HTTP status codes**: 400 = bad input, 404 = not found, 409 = conflict/duplicate, 422 = validation failure, 500 = only genuine unexpected errors.
- **Guard BigInt coercion**: `BigInt(Math.round(NaN))` throws. Wrap in a helper that checks `Number.isFinite()` first and defaults to `BigInt(0)` with a log warning.

## Execution Safety
- **Stale order recovery should use `updatedAt`, not `cancelDeadline`**: An order is stale if it hasn't been updated recently, not if its cancel deadline is past. Added `updatedAt @updatedAt` to PendingOrder.
- **Re-check `autoExecutionEnabled` between batch orders**: If toggled off mid-batch, stop picking up new orders immediately. Already-executing orders complete normally (T212 order is real).
- **Wrap duplicate check + create in `$transaction`**: Without a transaction, two concurrent imports can both pass the duplicate check and create the same trade. Use `$transaction` with a duplicate check inside it.
- **Adding required columns to tables with data**: Use `prisma db execute --stdin` with `ALTER TABLE ... ADD COLUMN ... DEFAULT` first, then `prisma db push` to sync. Can't add required columns without defaults when rows exist.
- **NEVER create Trade rows directly — always go through PendingOrder→autoExecutor**: `nightlyScan.ts` had two paths that created Trade rows directly in the DB without placing a T212 order or confirming a fill. This caused ghost/orphan positions: the Trade existed in the DB but T212 had no matching position. Cruise-control then ghost-closed them, freeing the slot, and the next scan created another phantom — an infinite loop eating slots. Fix: all signal paths must create PendingOrders. The autoExecutor handles T212 order placement, fill confirmation polling, and only creates the Trade row after T212 confirms FILLED.
