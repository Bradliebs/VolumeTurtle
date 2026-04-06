---
title: "TradeCore Wiki — Master Index"
updated: 2026-04-06
---

# TradeCore Wiki — Index

## System

- [[overview]] — Living system summary

## Architecture

- [[sacred-files]] — Six frozen core engine files
- [[data-flow]] — Universe → signal → score → size → execute → monitor

## Signals

- [[volume-spike]] — VolumeTurtle primary entry signal
- [[momentum-breakout]] — HBME sector momentum breakout signal

## Scoring

- [[composite-score]] — Net Composite Score (NCS) — primary signal grading
- [[regime-score]] — Regime component (QQQ + VIX + ticker trend)
- [[trend-score]] — Trend component (% above 50-day MA)
- [[volume-score]] — Volume component (spike ratio 2x–5x)
- [[liquidity-score]] — Liquidity component (dollar volume)
- [[breakout-power-score]] — BPS — momentum breakout scoring variant

## Regime

- [[regime-filter]] — Market regime detection (BULLISH/BEARISH, volatility states)

## Risk

- [[position-sizing]] — Dollar-based Kelly fraction sizing with equity curve override
- [[trailing-stops]] — Monotonic trailing stop with ATR hard floor
- [[equity-curve]] — Drawdown-based system state machine (NORMAL/CAUTION/PAUSE)

## Integrations

- [[t212-integration]] — Trading 212 API, ticker mapping, stop sync
- [[cruise-control]] — Intraday hourly stop ratchet daemon
- [[scheduled-scans]] — Task Scheduler setup (LSE 17:30, US 22:00)
- [[telegram-alerts]] — Telegram notification system

## Decisions

- [[adr-monotonic-stops]] — Why stops only move up
- [[adr-two-engine-architecture]] — VolumeTurtle + HBME dual engine
- [[adr-sector-rank-filtering]] — Why breakouts filtered by top-5 sectors
- [[adr-equity-curve-states]] — Why adaptive risk via drawdown states
- [[adr-range-position-filter]] — Why price must close in top 25% of range

## Research

_(No research pages yet — ingest sources to populate.)_

## Performance

_(No performance pages yet — paste trade results to populate.)_
