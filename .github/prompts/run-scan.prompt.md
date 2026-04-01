---
description: "Run a dry-run scan and summarise results — signals found, grades, skipped tickers, and regime state."
agent: "agent"
tools: [execute, read]
argument-hint: "Optional: market filter (LSE, US, or ALL)"
---

Run a VolumeTurtle dry-run scan and present a clear summary of the results.

## Steps

1. Run the scan in dry-run mode (no DB writes):
   ```
   npm run scan:dry
   ```
   If the user specified a market (LSE or US), pass it: `npm run scan:dry -- --market LSE`

2. Parse the output and present a summary table with:
   - **Regime**: Market regime (BULLISH/BEARISH), VIX level, QQQ vs 200MA
   - **Signals found**: List each ticker with grade (A/B/C/D), composite score, volume ratio, and suggested entry price
   - **Near misses**: Tickers that met some but not all criteria
   - **Skipped**: Count of tickers scanned but no signal
   - **Convergence**: Any tickers flagged by both volume and momentum engines
   - **Errors**: Any Yahoo fetch failures or data issues

3. Highlight actionable items:
   - Grade A/B signals → "Ready to place"
   - Grade C signals → "Caution — review manually"
   - Grade D signals → "Below threshold — skip"
   - If equity curve is in CAUTION or PAUSE state, note that entries may be blocked

4. If the scan fails or times out, check:
   - Is Docker/PostgreSQL running?
   - Are there stale node processes? (`taskkill /F /IM node.exe` may be needed)
   - Is the `.env` file present with DATABASE_URL?
