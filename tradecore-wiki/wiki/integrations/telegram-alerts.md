---
title: "Telegram Alerts"
category: integration
tags: [telegram, alerts, notifications]
updated: 2026-04-06
sources: []
confidence: high
---

Telegram bot notifications for scan results, breakout alerts, and stop breaches.

## Configuration

| Source | Priority |
|--------|----------|
| DB `TelegramSettings` table | Primary (checked first) |
| Env `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Fallback |

The `enabled` flag in `TelegramSettings` can disable all notifications without removing credentials.

## Alert Types

| Type | Trigger | Content |
|------|---------|---------|
| **BREAKOUT_TRIGGER** | Momentum alert engine | Ticker, change %, vol ratio, grade, sector |
| **STOP_BREACH** | Exit signal | Ticker, price, stop level |
| **Scan summary** | Scheduled scan completion | Tickers scanned, signals, exits, regime, duration |
| **Scan skipped** | Market holiday detected | Market name, date |
| **Scan failed** | Scan error | Error message |

## Implementation

File: `src/lib/telegram.ts`

Key functions:
- `sendTelegram({ text, parseMode })` — send message (HTML default)
- `formatAlertMessage(alert)` — format typed alert into HTML string

## See also

- [[scheduled-scans]]
- [[momentum-breakout]]
