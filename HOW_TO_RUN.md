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
| Mon-Fri hourly, 08:00–21:00 | **Agent cycle** → ratchets stops, executes signals, sends Telegram summary |
| Mon-Fri every 2 min, 08:00–21:00 | **Agent Telegram listener** → processes HALT/RESUME/STATUS commands |
| Sun 18:00 | **Agent** triggers universe snapshot for backtest replay |
| Sun 19:00 | **Agent** runs auto-tune, interprets results, sends plain-English verdict to Telegram |

**Your only job during the week:** check Telegram for trade alerts and the Sunday verdict.

---

## C. Monday morning routine (2 min)

**1. Check Telegram for the Sunday auto-tune verdict**

The agent already ran the auto-tune, interpreted the results, and sent you one of three verdicts:

- **APPLY** — new config validated. The message includes the exact `setx` commands to run. Copy-paste them, then restart the dev server (`START.bat`).
- **MONITOR** — improvement is marginal. No action needed.
- **IGNORE** — OOS gate failed. Do not change anything.

**2. Verify scheduler is healthy**
```powershell
npm run schedule:status
npm run schedule:agent:status
```
All tasks should show "Ready" or "Running".

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
| Agent cycle failed | Check `%USERPROFILE%\VolumeTurtle\logs\agent.log` |
| Agent Sunday failed | Check `%USERPROFILE%\VolumeTurtle\logs\agent-sunday.log` |
| Telegram silent | Verify `TelegramSettings.enabled = true` in DB |

---

## H. Agent control

### Enable / disable

**Settings UI** — go to `http://localhost:3000/settings`, scroll to "Autonomous Agent", toggle on/off. Takes effect on the next cycle.

**Direct DB** — for scripting:
```powershell
# Enable
echo 'UPDATE "AiSettings" SET enabled = true, "updatedAt" = NOW() WHERE id = 1;' | npx prisma db execute --stdin

# Disable
echo 'UPDATE "AiSettings" SET enabled = false, "updatedAt" = NOW() WHERE id = 1;' | npx prisma db execute --stdin
```

### Telegram commands

Send these to the Telegram bot chat (the agent listener checks every 2 min):

| Command | What it does |
|---|---|
| `HALT` | Sets the halt flag — agent skips all execution until resumed |
| `HALT reason text` | Halt with a specific reason |
| `RESUME` | Clears the halt flag — agent resumes on the next cycle |
| `PAUSE` | Turns off auto-execution — signals still scanned but no orders sent |
| `UNPAUSE` | Re-enables auto-execution |
| `STATUS` | Returns current positions, heat, regime, halt status |

### Halt vs Pause

- **HALT** stops the agent entirely — no ratchets, no executions, no actions. Use for emergencies.
- **PAUSE** only stops new entries — stops are still ratcheted, positions monitored. Use for "I want to watch but not trade."

### Log locations

| Log | Path |
|---|---|
| Weekday agent | `%USERPROFILE%\VolumeTurtle\logs\agent.log` |
| Sunday maintenance | `%USERPROFILE%\VolumeTurtle\logs\agent-sunday.log` |
| Telegram listener | `%USERPROFILE%\VolumeTurtle\logs\agent-listen.log` |

### Schedule management

```powershell
# Install agent tasks
npm run schedule:agent:setup

# Check agent task status
npm run schedule:agent:status

# Remove agent tasks (keeps core trading tasks)
npm run schedule:agent:remove
```

---

## TL;DR

**Set up once → it runs itself → check Telegram.**

The agent handles everything: hourly ratchets, signal execution, Sunday auto-tune with plain-English verdicts. The only manual step is running the `setx` commands when the agent says APPLY.
