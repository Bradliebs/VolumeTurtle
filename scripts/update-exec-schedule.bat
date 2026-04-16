@echo off
:: ─────────────────────────────────────────────────────────
::  Update VolumeTurtle scheduled tasks for optimal trading times
::
::  1. Execution scheduler: 08:00–17:00 UTC (every 1 min)
::  2. Midday scan: 12:00 UTC (scan for same-day overlap execution)
::
::  The evening scans (17:30 LSE, 22:00 US) remain unchanged.
::  This will prompt for your Windows password.
:: ─────────────────────────────────────────────────────────

echo.
echo === Updating Execution Scheduler: 08:00-17:00 UTC ===
schtasks /change /tn "VolumeTurtle_ExecutionScheduler" /st 08:00 /ri 1 /du 09:00
if not errorlevel 1 (
    echo   SUCCESS
) else (
    echo   FAILED — try running as Administrator
)

echo.
echo === Creating Midday Scan: 12:00 UTC weekdays ===
schtasks /query /tn "VolumeTurtle_Scan_Midday" >nul 2>nul
if not errorlevel 1 (
    echo   Task already exists — updating...
    schtasks /change /tn "VolumeTurtle_Scan_Midday" /st 12:00
) else (
    schtasks /create /tn "VolumeTurtle_Scan_Midday" /tr "cmd /c \"%~dp0midday-scan.bat\"" /sc weekly /d MON,TUE,WED,THU,FRI /st 12:00 /it
)
if not errorlevel 1 (
    echo   SUCCESS
) else (
    echo   FAILED — try running as Administrator
)

echo.
echo Schedule summary:
echo   12:00 UTC — Midday scan (detect signals, orders execute 13:15/14:45 same day)
echo   17:30 UTC — LSE scan (end-of-day, orders execute next day 13:15)
echo   22:00 UTC — US scan (end-of-day, orders execute next day 14:45)
echo   08:00-17:00 UTC — Execution scheduler (checks every 1 min)
echo.
pause
