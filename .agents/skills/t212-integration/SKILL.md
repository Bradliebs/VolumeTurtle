---
name: t212-integration
description: "Generate Trading 212 API code with correct ticker mapping, rate limiting, GBX conversion, and stop order flow. Use when: T212 API, Trading 212, stop order, T212 ticker, GBX pence conversion, T212 rate limit, position sync, T212 import."
---

# Trading 212 Integration

## When to Use
- Writing code that calls the T212 API
- Adding new T212 endpoints or features
- Debugging T212 stop order issues
- Mapping between Yahoo and T212 tickers
- Handling GBX (pence) price conversions

## Architecture

All T212 code lives in `src/lib/t212/client.ts`. Use existing functions — do NOT create parallel T212 clients.

### Authentication
```typescript
import { loadT212Settings, t212Fetch } from "@/lib/t212/client";
const settings = loadT212Settings(); // reads T212_API_KEY, T212_API_SECRET, T212_ENVIRONMENT
// HTTP Basic Auth: base64(apiKey:apiSecret)
```

### Key Functions (already exist — use these)
| Function | Purpose |
|----------|---------|
| `t212Fetch(path, settings, options?)` | Raw API call with 429 retry |
| `getOpenPositions(settings)` | All open positions |
| `getPositionsWithStopsMapped(settings)` | Positions with Yahoo tickers + GBP prices |
| `getCachedT212Positions(settings)` | 1-min cached wrapper (use this in most cases) |
| `updateStopOnT212(settings, yahooTicker, qty, stopGBP)` | Cancel old + place new stop |
| `loadT212Settings()` | Load from env vars, returns null if not configured |

### Base URLs
- Demo: `https://demo.trading212.com/api/v0`
- Live: `https://live.trading212.com/api/v0`

## Critical Rules

### 1. Ticker Mapping
T212 uses internal tickers (`PMOl_EQ`, `ASML_US_EQ`). Yahoo uses suffixes (`.L`, `.AS`).

```typescript
// ALWAYS map through instruments — never hardcode
import { getInstruments } from "@/lib/t212/client";
// t212ToYahooTicker(t212Ticker, instruments) — LSE→.L, EUR→.AS, USD→plain
// yahooToT212Ticker(yahooTicker, instruments) — reverse mapping
```

### 2. GBX (Pence) Conversion
LSE instruments are priced in GBX (pence), NOT GBP (pounds).

```typescript
// Reading from T212: divide by 100
if (instrument.currencyCode === "GBX") {
  price = price / 100; // pence → pounds
}

// Writing to T212: multiply by 100
if (isPence) {
  stopPrice = stopPriceGBP * 100; // pounds → pence
}
```
This conversion is handled automatically by `getPositionsWithStopsMapped()` and `updateStopOnT212()`. If you're calling `t212Fetch` directly, you MUST handle it yourself.

### 3. Rate Limiting
- T212 returns `429` with `x-ratelimit-reset` header
- `t212Fetch` retries 3× with exponential backoff automatically
- Between sequential write operations: wait 2.5s (`await sleep(2500)`)
- Use `getCachedT212Positions()` to avoid hitting limits from multiple routes

### 4. Stop Order Flow
The stop update is a 4-step process:
```
1. getPendingOrders() — find existing stop for ticker
2. cancelOrder(orderId) — remove old stop
3. sleep(2500) — respect rate limit
4. placeStopOrder(ticker, -qty, stopPrice) — place new (negative qty = sell)
```
This is wrapped in `updateStopOnT212()` — use it, don't reimplement.

### 5. Stop Floor Rule (ABSOLUTE)
**Never push a lower stop to T212.** T212's current stop is always treated as a floor.
```typescript
if (t212Stop != null && newStop <= t212Stop + 0.01) {
  // Skip — T212 already at or above requested level
}
```

### 6. Null Safety
T212 may return `null` for `stopLoss` on positions. Always check:
```typescript
const stopLoss = pos.stopLoss ?? null;
if (stopLoss == null) { /* no stop set on T212 */ }
```

## Common Mistakes
- Forgetting GBX conversion when calling `t212Fetch` directly → stop set 100× too high/low
- Not waiting 2.5s between cancel and place → 429 rate limit
- Hardcoding ticker format instead of mapping through instruments
- Using `getOpenPositions()` in hot paths → use `getCachedT212Positions()` instead
- Checking `pos.stopLoss` without also checking pending orders (stop may be a separate order)
