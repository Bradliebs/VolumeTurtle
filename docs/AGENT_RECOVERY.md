# 🚨 Agent Recovery Runbook

> When the agent goes wrong, read this. Steps are ordered for the worst case: it's 22:00, you're tired, and something is on fire. Do them in order. Don't skip.

---

## TL;DR — Most Common Fixes

| Symptom | First action |
|---|---|
| Agent placed a wrong trade | **PAUSE-EXECUTION** (Telegram) → manually close in T212 |
| Agent stuck halted | **RESUME** (Telegram) or click "▶ RESUME AGENT" in `/settings` |
| Stops not moving | Check cruise control task is running — see §4 |
| Position in T212 not in DB | Run reconciliation — see §2 |
| Position in DB not in T212 | Wait one agent cycle (auto-cleared as "ghost") — see §2 |
| Telegram silent for hours | Heartbeat broken — see §6 |

---

## 1. Take Manual Control NOW (the panic button)

If the agent is misbehaving and you need to stop it from doing anything else:

### Option A — Telegram (fastest, works anywhere)

Send to your bot:

```
HALT Agent acting up — taking manual control
```

This sets the halt flag. The agent will skip all tool calls until you send `RESUME`. Stops still ratchet via cruise control.

If you only want to stop **new trades and closes** but keep stops moving:

```
PAUSE-EXECUTION
```

This is safer than HALT because the agent keeps doing health checks and ratcheting stops.

### Option B — Settings UI

1. Open `http://localhost:3000/settings`
2. Scroll to **🤖 AUTONOMOUS AGENT**
3. Click **🛑 HALT AGENT** (red button)

### Option C — Kill the dev server (nuclear)

Only if the UI itself is broken:

```powershell
Get-Process node | Stop-Process -Force
```

This stops the agent from making any API calls (the agent calls `/api/...` over HTTP — no server, no calls). T212 stops keep working server-side.

---

## 2. Reconcile DB vs T212 Positions Manually

The agent already does this every cycle — closes any DB trade missing from T212 for 2+ cycles as a "ghost". Sometimes you need to do it yourself.

### Quick visual check

1. Open `http://localhost:3000` (dashboard)
2. Open T212 app
3. Compare the open positions list

### What to do for each mismatch

| In DB | In T212 | Action |
|---|---|---|
| ✓ | ✓ | All good |
| ✓ | ✗ | DB has a ghost — wait 2 agent cycles, it auto-closes. Or manually close (§3). |
| ✗ | ✓ | T212 has an unimported position — see below |
| ✗ | ✗ | Nothing to do |

### T212 has a position not in the DB

Either you bought it manually outside the system, or an old trade got closed in DB but not T212.

**Safest fix:** import it via the dashboard:

```powershell
# Find the unimported tickers
# Dashboard shows them under "Unmanaged Positions"
```

If the dashboard's import flow is broken, raw SQL fix (use sparingly):

```sql
-- Insert manually (replace values)
INSERT INTO "Trade" (id, ticker, "entryPrice", shares, "hardStop", "trailingStop", status, "entryDate", "importedFromT212", currency)
VALUES (gen_random_uuid()::text, 'TICKER.L', 100.50, 10, 95.0, 95.0, 'OPEN', NOW(), true, 'GBP');
```

---

## 3. Close a Position Manually if Agent Close Fails

If the agent's `close_position` returns errors (e.g., T212 rate limit or wrong instrument code):

### Step 1 — Close it in T212 directly

1. Open T212 app
2. Find the position
3. Sell at market

### Step 2 — Mark it closed in the DB

The agent's ghost reconciliation will catch it within 2 cycles. If you can't wait, force it:

```powershell
# From the project root:
npx tsx scripts/closeGhostFold.ts
```

Or via DB directly (cuid is the trade `id` from the dashboard):

```sql
UPDATE "Trade"
SET status = 'CLOSED',
    "exitDate" = NOW(),
    "exitPrice" = <fill in T212 fill price>,
    "exitReason" = 'MANUAL — closed in T212, force-closed in DB'
WHERE id = '<cuid>';
```

### Step 3 — Check stop history is clean

```sql
-- Should show no orphans
SELECT * FROM "StopHistory" WHERE "tradeId" NOT IN (SELECT id FROM "Trade");
```

---

## 4. Stops Aren't Moving

Stops are managed by **two separate systems** that both ratchet upward. Both have to fail for stops to be stuck.

### Check 1 — Cruise control task is running

```powershell
schtasks /query /tn "VolumeTurtle_CruiseControl" /fo LIST /v | Select-String "Last Run|Status|Scheduled Task State"
```

If `Scheduled Task State` ≠ `Enabled`, re-enable:

```powershell
schtasks /change /tn "VolumeTurtle_CruiseControl" /enable
```

### Check 2 — Agent task is running

```powershell
schtasks /query /tn "VolumeTurtle_Agent" /fo LIST /v | Select-String "Last Run|Scheduled Task State"
```

### Check 3 — Run cruise control once manually

```powershell
npx tsx -e "import('./src/lib/cruise-control/cruiseControlEngine').then(m => m.runCruiseControlCycle()).then(r => console.log(JSON.stringify(r, null, 2)))"
```

Or, if you have the bat file:

```powershell
.\scripts\cruise-daemon.bat
```

### Check 4 — Verify T212 has the latest stops

Open the dashboard. If header shows **⚠ STOP UPDATES NEEDED**, click **↻ SYNC ALL** in the header to push pending changes to T212.

If header shows **⚠ N UNPROTECTED**, those positions have no T212 stop at all. Click into each one in the trades table → **Push stop to T212** button.

---

## 5. Clear a Stuck Halt Flag

The halt flag can get stuck on if:
- Agent set it during a Sunday/Friday maintenance run and didn't clear
- Telegram listener wrote it but never got the RESUME message
- DB row got into an unexpected state

### Telegram (preferred)

```
RESUME
```

For the execution-only pause:

```
RESUME-EXECUTION
```

### Settings UI

1. `/settings` → **🤖 AUTONOMOUS AGENT**
2. Click **▶ RESUME AGENT** (green button)
3. If `Execution Paused` toggle is amber, click it to turn off

### Direct DB (if both above fail)

```sql
UPDATE "AgentHaltFlag"
SET halted = false,
    "executionPaused" = false,
    reason = NULL,
    "setBy" = 'MANUAL_RECOVERY'
WHERE id = 1;
```

Verify:

```sql
SELECT * FROM "AgentHaltFlag";
```

---

## 6. Agent Telegram Has Gone Silent

The agent should send a Telegram summary every cycle (hourly Mon–Fri 08:00–21:00). If you've heard nothing for 2+ hours during market hours, something is wrong.

### Check 1 — Dashboard heartbeat

Open `http://localhost:3000`. Header shows:

```
Agent: <time> (Xs · N tools)
```

If the time is > 90 min old during market hours, header text is **red ⚠ STALE**.

### Check 2 — Failure file

```powershell
type "$env:USERPROFILE\VolumeTurtle\agent-failures.txt"
```

If file exists and shows `>= 2`, the agent is failing Claude API calls. Common causes:
- Anthropic outage
- API key revoked / out of credit
- Rate limit hit

### Check 3 — Dev server is up

```powershell
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*VolumeTurtle*' -or $_.Path -like '*VolumeTurtle*' }
```

If nothing returned, start it:

```powershell
.\START.bat
```

### Check 4 — Run a cycle manually to see the error

```powershell
npm run agent
```

Read the output. The error will tell you what's broken.

### Check 5 — Reset the failure counter manually

After fixing the cause:

```powershell
Remove-Item "$env:USERPROFILE\VolumeTurtle\agent-failures.txt" -ErrorAction SilentlyContinue
```

Next successful cycle will keep it cleared.

---

## 7. Last-Resort Full Reset

When nothing else works:

1. **HALT the agent** (Telegram or UI)
2. **Stop all scheduled tasks:**
   ```powershell
   schtasks /change /tn "VolumeTurtle_Agent" /disable
   schtasks /change /tn "VolumeTurtle_ExecutionScheduler" /disable
   schtasks /change /tn "VolumeTurtle_CruiseControl" /disable
   ```
3. **Open T212 directly.** All stop orders are held server-side. They will execute regardless of whether your PC is on.
4. **Decide manually** which positions to keep, close, or adjust stops on.
5. **Take a backup before doing any DB work:**
   ```powershell
   npm run backup
   ```
6. **When ready to resume**, re-enable tasks one at a time:
   ```powershell
   schtasks /change /tn "VolumeTurtle_CruiseControl" /enable
   # Watch one cycle, confirm stops moved correctly
   schtasks /change /tn "VolumeTurtle_Agent" /enable
   ```

---

## Escalation & Contacts

| Issue | Where to look |
|---|---|
| T212 API down | https://www.trading212.com/status |
| Anthropic API down | https://status.anthropic.com |
| Yahoo Finance data wrong | `npx tsx scripts/checkQuoteCoverage.ts` |
| DB corruption | Latest backup at `%USERPROFILE%\VolumeTurtle\backups\` — restore with `npx tsx scripts/restore.ts` |
| System logs | `%USERPROFILE%\VolumeTurtle\logs\` |
| Decision audit | DB table `AgentDecisionLog` — most recent rows show what the agent did and why |

---

## Three things to remember at 22:00

1. **T212 stops protect you regardless of what the agent does.** Even if the PC is off, your stops execute.
2. **HALT first, diagnose second.** It's safer to stop the agent and figure it out than let it keep running.
3. **The DB is the source of truth for the agent. T212 is the source of truth for actual money.** When they disagree, T212 wins — fix the DB to match.
