# Todo

- [x] Audit current schema/config and locate HBME source files
- [x] Rebrand package name consistently
- [x] Add Prisma schema changes for HBME merge infrastructure
- [x] Copy shared HBME library files with VolumeTurtle import paths
- [x] Add momentum universe loader and supporting HBME types
- [x] Run Prisma migration: merge_hbme_schema
- [x] Verify no UI/API/risk logic regressions

## Review

- Migration command executed, but Prisma reported existing schema drift and aborted before creating the migration. `prisma generate` completed successfully after schema edits.
- Added infrastructure-only HBME files without wiring them into routes/UI.

## Current Task

- [x] Trace false closed-trade entries back to scan/sync write paths
- [x] Prevent auto-close when T212 is configured but unavailable
- [x] Reconcile dashboard/journal closed-trade lists against live T212 holdings
- [x] Add regression tests for false-close reconciliation
- [x] Run test suite and review results

### Review

- Added a shared trade-status helper so scan/sync routes only auto-close when T212 is either not configured or explicitly confirms the position is no longer held.
- Dashboard and journal now suppress the latest false-closed row for tickers still held on T212 when there is no matching open trade in the DB.
- Verification: `npm test` passed with 13/13 suites and 189/189 tests.
- Extended the helper to detect duplicate OPEN/CLOSED twin trades for the same entry, which was the actual SPIR case.
- Added `scripts/repairFalseClosedTrades.ts` plus npm scripts for dry-run and apply.

## Auto-Execution Feature (2026-04-10)

- [x] Add PendingOrder + ExecutionLog models to Prisma schema
- [x] Add auto-execution fields to AppSettings
- [x] Run prisma db push + generate
- [x] Create `src/lib/execution/autoExecutor.ts` (SACRED) — 10 pre-flight checks, order placement, Telegram alerts
- [x] Create `src/lib/execution/executionScheduler.ts` — polls pending orders past deadline
- [x] Create `scripts/executionScheduler.ts` — standalone script for Task Scheduler
- [x] Create API: `GET/DELETE/POST /api/execution/pending` — list, cancel, execute-now, emergency disable
- [x] Create API: `GET /api/execution/log` — execution audit trail
- [x] Create API: `GET/POST /api/execution/settings` — auto-execution config
- [x] Integrate into nightlyScan.ts — creates PendingOrder for Grade A/B when auto-exec enabled
- [x] Integrate into momentum scan section — same for momentum Grade A/B
- [x] Create `src/app/execution/page.tsx` — countdown timers, cancel/execute-now UI
- [x] Update settings page — auto-execution card with enable confirmation, emergency stop, execution history
- [x] Add PENDING nav link to all pages (dashboard, journal, momentum, watchlist, settings)
- [x] TypeScript compiles clean (only pre-existing page.tsx warnings)
- [x] All 212 tests pass, 0 regressions
- Created a backup at `C:\Users\Brad\VolumeTurtle\backups\volumeturtle_backup_2026-04-09.json` before applying the DB repair.
- Applied the repair and deleted the false closed SPIR twin (`cmnqfiacb000aacu7kfljz2do`).
- Verification after repair: `npm run repair:false-closes -- --ticker=SPIR` found no candidates; `npm test` passed with 13/13 suites and 191/191 tests.
- Added closed-entry duplicate detection (same ticker + entry timestamp + entry price + shares) to hide stale duplicate closed rows in dashboard/journal.
- BKSY had one duplicate closed group (3 rows). After backup, deleted the 2 older twins and kept the latest close record.
- Verification after BKSY cleanup: only one BKSY row remains in DB and `npm test` passed with 13/13 suites and 193/193 tests.

## Current Task

- [x] Implement cross-process T212 endpoint throttle coordination
- [x] Keep in-process fallback pacing when DB settings are unavailable
- [x] Run full test suite after throttle changes

### Review

- Added DB-backed endpoint slot reservation in `src/lib/t212/client.ts` using the existing `Settings` table (`t212_rate_next_allowed_at:*` keys).

## Backlog

- [ ] **Conditional Displacement Rule** — When all position slots are occupied AND an incoming signal is Grade B or better AND an existing position is >15 days old with P&L between -1R and +0.5R, flag it as a displacement candidate so the new signal can take its slot.
  - **Source:** Agent-proposed design (2026-04-19) after spotting tension between full-portfolio state and a fresh Grade B signal with no available slot.
  - **Key insight:** This is a *slot-quality gate*, not a time-stop. The rule deliberately excludes positions running well (e.g. +1R at 20 days does NOT get displaced) — only genuinely dead weight in the dead band qualifies. Preserves right-tail convexity.
  - **Thresholds (proposed, conservative):**
    - Age: ≥15 days since entry
    - P&L band: between -1R and +0.5R (the "neither working nor stopped out" zone)
    - Incoming signal: Grade B or better
    - Trigger condition: all slots occupied (no free capacity)
  - **Implementation guardrails:**
    - Agent **flags only** — never auto-closes. Human confirms displacement.
    - Requires backtest validation against historical trades before shipping (does displacing dead-band positions actually improve aggregate R? or does it churn names that would have eventually mean-reverted to a winner?)
    - Likely lives as a new module under `src/lib/risk/` (do not modify sacred files like `positionSizer.ts` or `ratchetStops.ts`).
    - New tool for the agent (`flag_displacement_candidate`) added to `src/agent/tools.ts` once validated.
  - **Status:** Not approved for implementation. Backtest first, then re-evaluate thresholds.
- [ ] **Close route latent bug** — `currentStop` reference reads a field that doesn't exist on Trade model (field is `trailingStop` or `trailingStopPrice`). Fix when touching the close route next.
- [ ] **GBX→GBP normalisation** — `pnlGbp` calculation in trade journal and close route uses raw price units. For `.L` tickers Yahoo prices are in pence, so `pnlGbp` is actually `pnlGbx`. Needs a normalisation pass across all pnl calculations.
- [ ] **Regime health data resilience** — `check_regime_health` fetches SPY/^FTSE live from Yahoo. If Yahoo is down, regime health fails. Consider seeding these benchmark tickers into the `DailyQuote` universe so the handler can fall back to cached DB data.
- [ ] **Universe curation N+1 queries** — `curate_universe` runs 3 queries per ticker × 1,429 tickers ≈ 4,300 queries. Currently fast enough locally but should be refactored to batch queries using `groupBy` over `DailyQuote` and `PendingOrder` if it becomes slow. Low priority.
- [ ] **Regime health cross-process cache** — current cache is module-level (resets per `tsx` invocation). For true daily caching across hourly cycles, store the result in `AppSettings` or a new `AgentCache` table keyed by date. Low priority — one Yahoo call per cycle is within rate limits.
- [ ] **Regime history table** — `run_drawdown_forensics` uses a heuristic for `REGIME_FAILURE` cause (currently bearish + 5d window). True detection needs a `RegimeHistory` table logging each regime flip with date. Add when drawdown forensics needs more precision.
- [ ] **Drawdown forensics open position P&L** — currently uses mark-to-stop. Consider mark-to-last-price for more accurate contribution calc, but requires Yahoo fetch per ticker during CRITICAL alert. Evaluate cost vs accuracy tradeoff.
- [ ] **AgentDecisionLog skipped signal detection** — currently uses brittle string match on `actionsJson`. Add a structured `skippedSignals` Json field to `AgentDecisionLog` so forensics can query it reliably.
- Reservation uses a compare-and-set loop (`findUnique` + `updateMany where key+value`) so concurrent processes serialize endpoint access without requiring schema migrations.
- Existing in-memory pacing remains as fallback if DB access fails.
- Verification: `npm test` passed with 13/13 suites and 193/193 tests.

## Current Task

- [x] Add latest-per-ticker closed outcome view
- [x] Add grouped closed history with expandable timeline
- [x] Add cumulative closed P/L and cumulative R summary
- [x] Run full test suite after UI changes

### Review

- Updated dashboard trade history UI in `src/app/page.tsx` with a closed-mode toggle: `LATEST/TICKER` and `GROUPED HISTORY`.
- Added cumulative metrics in header (`Closed P/L`, `Cum R`) so total progress over time is always visible.
- Grouped history now expands each ticker into a per-trade timeline with running P/L and running R.
- Verification: `npm test` passed with 13/13 suites and 193/193 tests.
