# Cruise Control — Windows Task Scheduler Setup

## Overview

Run the cruise control daemon hourly during market hours via Windows Task Scheduler, independent of the Next.js app.

## Prerequisites

- Node.js and npm installed and on PATH
- Project dependencies installed (`npm install`)
- `.env` file with `DATABASE_URL` and T212 credentials configured
- The `logs/` directory will be created automatically on first run

## Setting Up the Scheduled Task

### Option A: Using Task Scheduler GUI

1. Open **Task Scheduler** (`taskschd.msc`)
2. Click **Create Task** (not "Create Basic Task")

#### General Tab
- **Name:** `VolumeTurtle Cruise Control`
- **Description:** `Hourly stop ratcheting for open positions during market hours`
- **Security options:**
  - Select **Run whether user is logged on or not**
  - Check **Do not store password** (if the script doesn't need network drives)
  - **Configure for:** Windows 10 / Windows Server 2016

#### Triggers Tab
- Click **New…**
- **Begin the task:** On a schedule
- **Settings:** Daily
- **Start:** `08:00:00`
- **Recur every:** 1 day
- **Advanced settings:**
  - Check **Repeat task every:** `1 hour`
  - **for a duration of:** `9 hours` (covers 08:00–17:00)
  - Check **Enabled**
  - Check **Stop task if it runs longer than:** `30 minutes`

#### Actions Tab
- Click **New…**
- **Action:** Start a program
- **Program/script:** `cmd.exe`
- **Add arguments:** `/c "C:\VolumeTurtle\VolumeTurtle\scripts\cruise-daemon.bat"`
- **Start in:** `C:\VolumeTurtle\VolumeTurtle`

> **Note:** Adjust the path above if your project is in a different location.

#### Conditions Tab
- Uncheck **Start the task only if the computer is on AC power**
- Uncheck **Stop if the computer switches to battery power**

#### Settings Tab
- Check **Allow task to be run on demand**
- Check **If the task fails, restart every:** `5 minutes`, up to `3` times
- Check **Stop the task if it runs longer than:** `30 minutes`
- **If the task is already running:** `Do not start a new instance`

3. Click **OK** and enter your Windows password if prompted.

### Option B: Using PowerShell (Run as Administrator)

```powershell
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument '/c "C:\VolumeTurtle\VolumeTurtle\scripts\cruise-daemon.bat"' `
    -WorkingDirectory "C:\VolumeTurtle\VolumeTurtle"

$trigger = New-ScheduledTaskTrigger `
    -Daily `
    -At "08:00" `
    -DaysInterval 1

# Repeat every hour for 9 hours (08:00–17:00)
$trigger.Repetition.Interval = "PT1H"
$trigger.Repetition.Duration = "PT9H"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName "VolumeTurtle Cruise Control" `
    -Description "Hourly stop ratcheting for open positions during market hours" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal
```

> **Adjust the paths** in `-Argument` and `-WorkingDirectory` to match your installation.

## Weekday-Only Restriction

The script itself has a built-in market hours guard (`isMarketOpen()`) that checks for weekends and bank holidays. Even if the task fires on a Saturday, the script will log "Outside market hours" and exit immediately with code 0.

If you want to prevent Task Scheduler from even launching the process on weekends, modify the trigger's **Days of the Week** to Mon–Fri only in the GUI, or add this in PowerShell:

```powershell
$trigger.DaysOfWeek = 0x3E  # Mon(2)+Tue(4)+Wed(8)+Thu(16)+Fri(32) = 62 = 0x3E
```

## Verifying the Setup

1. **Manual test run:**
   ```
   scripts\cruise-daemon.bat
   ```
   Check `logs\cruise-YYYY-MM-DD.log` for output.

2. **Task Scheduler test:**
   Right-click the task → **Run**. Check Last Run Result in Task Scheduler (0x0 = success).

3. **Check logs:**
   ```
   type logs\cruise-daemon.log
   type logs\cruise-2026-04-03.log
   ```

## Log Files

| File | Contents |
|------|----------|
| `logs/cruise-YYYY-MM-DD.log` | Per-day structured log with timestamps, tickers, old/new stops, and reasons |
| `logs/cruise-daemon.log` | Combined stdout/stderr from the batch file (appended each run) |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Task runs but nothing happens | Check `.env` has `DATABASE_URL`. Check `logs/cruise-daemon.log` for errors. |
| "Outside market hours" every time | Verify system clock/timezone. The script uses UK time via `isMarketOpen()`. |
| T212 update failures | Check `.env` has `T212_API_KEY` and `T212_API_SECRET`. Check T212 rate limits. |
| "DATABASE_URL not set" | Ensure `.env` is in the project root, not in `scripts/`. |
| Task shows 0x1 (error) | Check `logs/cruise-daemon.log` for the stack trace. |
