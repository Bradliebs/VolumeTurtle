# How to Run VolumeTurtle — Step by Step

> Operational runbook as of 2026-04-18, after the autonomous self-tuning layer was added.
> For the system architecture, see [SYSTEM_BREAKDOWN_2026-04-18.md](SYSTEM_BREAKDOWN_2026-04-18.md).

---

## A. First-time setup (one time only)

**1. Install dependencies & DB schema**
```powershell
.\INSTALL.bat
```
Installs npm packages, runs `prisma generate`, pushes schema to your Postgres DB.

**2. Set required env vars** (in `.env` at repo root)
```
DATABASE_URL=postgresql://...
T212_API_KEY=your_key
T212_API_SECRET=your_secret
TELEGRAM_BOT_TOKEN=...        # optional
TELEGRAM_CHAT_ID=...          # optional
SCHEDULED_SCAN_TOKEN=anything # required for scheduler
```

**3. Apply the OOS-validated config** (the auto-tune's recommendation)
```powershell
setx RISK_PER_TRADE_PCT 1
setx HEAT_CAP_PCT 0.08
```
**Close and reopen your terminal** for these to take effect.

**4. Confirm AppSettings has B-grade floor**
- Start the app: `.\START.bat`
- Open `http://localhost:3000/settings`
- Verify `Auto-Execution Min Grade = B` and `Max Positions Per Sector = 2`
- Verify `Auto-Execution Enabled = ON`

**5. Connect Trading 212**
- Open `http://localhost:3000/settings`
- Enter API key + secret, choose `live` or `demo`
- Confirm "Connected" status appears

**6. Install the scheduled tasks**
```powershell
npm run schedule:setup
```
This adds 6 Windows scheduled tasks (scans, executor, cruise control, snapshots, auto-tune).

---

## B. Daily operation (zero-touch)

After setup, **the system runs itself**. Scheduled tasks handle:

| Time | What happens |
|---|---|
| Mon-Fri 17:30 | LSE scan → creates PendingOrders |
| Mon-Fri 22:00 | US scan → creates PendingOrders |
| Mon-Fri every 5 min, 08:00–21:00 | Executor processes PendingOrders → sends to T212 |
| Mon-Fri hourly, 08:00–21:00 | Cruise control ratchets stops upward |
| Sun 18:00 | Universe snapshot for backtest replay |
| Sun 19:00 | Auto-tune → writes recommendation + Telegram alert |

**Your only job during the week:** check Telegram for trade alerts and daily reports.

---

## C. Monday morning routine (5 min)

**1. Check the auto-tune recommendation from Sunday**
```powershell
type data\recommendations\latest.json
```
Look at `oosValidation.verdict`:
- `PROMOTE_OK` + same combo as last week → no action needed
- `PROMOTE_OK` + new combo → consider applying it (see section E)
- `OOS_GATE_FAILED` → don't change anything, system flagged uncertainty

**2. Verify scheduler is healthy**
```powershell
npm run schedule:status
```
All 6 tasks should show "Ready" or "Running".

**3. Check trades dashboard**
- Open `http://localhost:3000`
- Review any new trades from the previous Friday's US scan

---

## D. On-demand commands (anytime)

```powershell
# See what would happen tonight (no DB writes)
npm run scan:dry

# Force a scan now
npm run scan

# Backup the DB before any risky change
npm run backup

# Run a quick parameter sweep (8 combos, ~1 min)
npm run backtest:sweep:quick

# Investigate a specific past backtest
npm run backtest:analyze -- --run=134

# Honest validation — does the strategy survive out-of-sample?
npm run walkforward

# Run the full auto-tune manually (don't wait for Sunday)
npm run tune

# Same + send Telegram
npm run tune:notify
```

---

## E. When the auto-tune recommends a NEW config

This is the **only** point where you make decisions. The flow:

**1. Read the recommendation**
```powershell
type data\recommendations\latest.json
```

**2. Check the OOS verdict** — must be `PROMOTE_OK`. If `OOS_GATE_FAILED`, ignore.

**3. Check the delta vs previous** — if `delta.deltaPF` is small (< 0.3), don't bother changing.

**4. If you want to apply** the new params, set the env vars:
```powershell
# Example: recommendation says risk=1.5%, heat=5%
setx RISK_PER_TRADE_PCT 1.5
setx HEAT_CAP_PCT 0.05
```

**5. Restart the dev server** (`START.bat`) for the env vars to take effect.

**6. AppSettings changes** (grade floor, sector cap) are made via the Settings UI at `http://localhost:3000/settings` — they take effect immediately, no restart needed.

---

## F. Stopping / pausing the system

**Pause auto-execution only** (signals still scanned, no orders sent):
- Settings UI → toggle `Auto-Execution Enabled = OFF`

**Stop everything cleanly:**
```powershell
npm run schedule:remove
```
Removes all scheduled tasks. Re-run `npm run schedule:setup` when you want it back.

---

## G. Troubleshooting

| Symptom | Fix |
|---|---|
| Scan returns 0 signals | `npm run universe:health` — check ticker coverage |
| Order didn't execute | Check `ExecutionLog` in DB or `/execution` page in UI for the failed pre-flight check |
| Stop didn't push to T212 | Check `T212Connection.connected` is true; check rate limit in logs |
| Auto-tune failed | Check `%USERPROFILE%\VolumeTurtle\logs\autotune.log` |
| Telegram silent | Verify `TelegramSettings.enabled = true` in DB |

---

## TL;DR

**Set up once → it runs itself → check Telegram & Monday recommendation file.**

The only weekly decision: do you trust the latest `data/recommendations/latest.json` enough to update env vars? If `PROMOTE_OK` + meaningful `deltaPF` → yes. Otherwise leave it.
