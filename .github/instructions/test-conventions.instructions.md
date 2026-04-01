---
description: "Test conventions for VolumeTurtle. Use when writing or modifying unit tests. Covers config mocking, Prisma workaround, test helpers."
applyTo: "src/__tests__/**"
---

# Test Conventions

## Always Mock Config
Every test file that imports any module using `@/lib/config` must mock it first:
```typescript
jest.mock("@/lib/config", () => require("../../__mocks__/config"));
// or for deeply nested tests:
jest.mock("@/lib/config", () => require("../../../__mocks__/config"));
```
The mock lives at `src/__tests__/__mocks__/config.ts` with safe defaults (£10k balance, 5 max positions, 2% risk).

## Prisma Import Workaround
Prisma's generated client uses `import.meta` which breaks Jest. If your test imports a module that transitively imports `@/db/client`, you must mock the heavy dependencies:
```typescript
jest.mock("@/lib/t212/client", () => ({
  loadT212Settings: () => null,
  getCachedT212Positions: async () => ({ positions: [], fromCache: true }),
}));
jest.mock("@/lib/data/yahoo", () => ({ fetchQuote: async () => null }));
jest.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));
```
If your module under test is **pure logic** (no DB, no network), import it directly — no mocks needed.

## Test Helpers
Use the helpers in `src/__tests__/helpers.ts`:
```typescript
import { generateQuotes, makeQuote } from "../../helpers";

// Generate N days of synthetic OHLCV bars
const quotes = generateQuotes(30, { basePrice: 100, spread: 2 });

// Build a single quote with specific values
const q = makeQuote({ date: "2025-03-15", close: 105, volume: 2_000_000 });
```

## Structure
- Location: `src/__tests__/lib/**/*.test.ts` — mirror the `src/lib/` structure
- Use `describe` blocks for logical groupings
- Use clear test names: `"returns null when newStop < currentStop"`
- Run `npm test` before marking any work complete
