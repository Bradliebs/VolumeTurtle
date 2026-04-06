---
title: "Cruise Control"
category: integration
tags: [cruise-control, daemon, intraday, stops]
updated: 2026-04-06
sources: []
confidence: high
---

Intraday daemon that polls positions hourly during market hours and ratchets trailing stops.

## Schedule

Runs via Windows Task Scheduler — hourly from 08:00 for 9 hours (covers LSE + US session).

## Behaviour

1. Check if any market is open (LSE 08:00–16:30, US 14:30–20:55 UK time)
2. If no market open, exit immediately
3. Load all OPEN trades
4. For each trade in an open market:
   - Fetch latest quotes
   - Recalculate trailing stop
   - Enforce monotonic guard
   - Optionally push to T212
5. Log results to `logs/cruise-YYYY-MM-DD.log`

## Market Hours (UK Time)

| Market | Open | Close | Blackout |
|--------|------|-------|----------|
| LSE | 08:00 | 16:35 | Last 5 min |
| US | 14:30 | 21:00 | Last 5 min |

## Holiday Handling

UK bank holidays and US market holidays are hardcoded in `market-hours.ts` (2025–2028). Markets are skipped on their respective holidays.

## Implementation

Files:
- `scripts/cruise-daemon.ts` — daemon entry point
- `src/lib/cruise-control/market-hours.ts` — market open/holiday logic

## See also

- [[trailing-stops]]
- [[t212-integration]]
- [[scheduled-scans]]
