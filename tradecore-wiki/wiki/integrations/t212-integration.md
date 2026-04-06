---
title: "Trading 212 Integration"
category: integration
tags: [t212, trading-212, api, execution, stops]
updated: 2026-04-06
sources: []
confidence: high
---

Trading 212 API integration for position monitoring and stop order management.

## Authentication

HTTP Basic Auth: `base64(apiKey:apiSecret)` in Authorization header.

## Key Operations

| Operation | Notes |
|-----------|-------|
| Get positions | `getCachedT212Positions()` — 1-min cache to avoid rate blanking |
| Get instruments | `getInstruments()` — ticker mapping (T212 internal IDs differ from Yahoo) |
| Place stop order | Cancel existing → wait 2.5s → place new order |
| Update stop | Never push a lower stop than T212's current floor |

## Ticker Mapping

T212 internal tickers (e.g. `PMOl_EQ`) differ from Yahoo tickers (e.g. `HBR.L`). Always map through `getInstruments()`.

## Rate Limiting

- Respect `x-ratelimit-reset` header
- Retry on 429 with backoff
- Use cached positions to minimise calls

## Currency: GBX Conversion

LSE prices from Yahoo arrive in pence (GBX). Divide by 100 for GBP before comparison with T212 prices (which are in GBP).

## Stop Order Flow

1. Read current T212 stop price for position
2. Check monotonic guard: new stop ≥ T212 current stop
3. Cancel existing stop order
4. Wait 2.5 seconds (T212 cooldown)
5. Place new stop order at ratcheted price

## Implementation

Files:
- `src/lib/t212/client.ts` — API client, caching, rate limiting
- `src/lib/t212/instruments.ts` — ticker mapping

## See also

- [[trailing-stops]]
- [[cruise-control]]
