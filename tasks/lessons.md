# Lessons Learned

## Dev Server
- Next.js "missing required error components" = browser opened before server is ready, or stale node process holding the port. Fix: kill node, clean .next + webpack cache, wait for 200, then open browser.
- Always kill old node.exe before starting dev server — port conflicts cause cascading failures.
- Multiple simultaneous dev servers corrupt webpack HMR state → 404 after initial 200.

## T212 API
- T212 rate limits are strict: stop orders = 1 req/2s, pending orders = 1 req/5s. Always add delays between sequential calls.
- `t212Fetch` must retry on 429 with exponential backoff using `x-ratelimit-reset` header.
- The stop push flow (getPositions + getPendingOrders + cancelOrder + placeStopOrder) is 4+ calls — needs ~3s delay between lookup and order operations.
- When T212 stop is already at or above the requested level, return success (no-op) instead of an error — the user doesn't need to know it was a no-op.
- System stops and T212 stops are two separate data sources — they can drift apart. T212 may be higher if the user manually raised it. Always treat T212's stop as a floor: if T212 > system, pull system up. Never instruct the user to lower a T212 stop.
- The T212 portfolio table and daily instructions must use the SAME stop source for tracked positions (database trade stops, not fresh market calculations).
- **CRITICAL**: Never auto-close a trade in the DB without checking T212 positions first. The scan routes were auto-closing on trailing stop breach without T212 verification, causing trades to show as CLOSED while the user still held the position. Always use `getCachedT212Positions()` and skip auto-close if T212 confirms position is still held.

## Prisma / Database
- `prisma generate` only updates TypeScript types — it does NOT create or alter database tables. Always run `npm run db:push` (or `npx prisma db push`) after editing `prisma/schema.prisma`.
- Verify new tables exist with `npx prisma studio` before marking schema work complete.

## CSV / Data Files
- `data/universe.csv` had mixed line endings (CRLF for first ~208 lines, LF for the rest). PapaParse choked on this, treating the rest of the file as extra fields of one row (3811 fields).
- Always normalize line endings when generating or editing CSV files. `loadUniverse()` now strips `\r\n` → `\n` before parsing as a safeguard.
- Don't throw on PapaParse `FieldMismatch` errors — they're non-fatal warnings (e.g. a trailing comma on one row). Only throw on structural errors that prevent data from being parsed.
