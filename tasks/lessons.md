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
