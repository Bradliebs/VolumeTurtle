---
title: "Scheduled Scans"
category: integration
tags: [scheduler, cron, lse, us, scan]
updated: 2026-04-06
sources: []
confidence: high
---

Automated nightly scans via Windows Task Scheduler hitting the Next.js API.

## Schedule

| Task | Time (UK) | Market | Endpoint |
|------|-----------|--------|----------|
| `VolumeTurtle_LSE_Scan` | 17:30 weekdays | LSE | `/api/scan/scheduled?market=LSE` |
| `VolumeTurtle_US_Scan` | 22:00 weekdays | US | `/api/scan/scheduled?market=US` |
| `VolumeTurtle_Startup` | On login | — | `start.bat` (launches dev server) |

## Authentication

`SCHEDULED_SCAN_TOKEN` env var — sent as `Authorization: Bearer <token>` header via curl.

## What the Scan Does

1. Validates token
2. Checks if market is closed (holiday) — skips with Telegram notification
3. Loads account balance and equity curve state
4. Fetches EOD quotes for market-filtered universe
5. Generates volume spike signals and scores them
6. Processes exits on open trades (hard stop + trailing stop)
7. Updates trailing stops on surviving positions
8. Saves AccountSnapshot
9. Sends Telegram summary (signals, exits, regime, duration)
10. Returns JSON result to curl

## Setup

Run `scripts/setupScheduler.bat` to create all three scheduled tasks.

## See also

- [[cruise-control]]
- [[telegram-alerts]]
