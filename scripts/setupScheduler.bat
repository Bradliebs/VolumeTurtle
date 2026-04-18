@echo off
setlocal enabledelayedexpansion
echo Setting up VolumeTurtle scheduled tasks...
echo.

REM --- Validate required env var ---
if "%SCHEDULED_SCAN_TOKEN%"=="" (
  echo ERROR: SCHEDULED_SCAN_TOKEN environment variable is not set.
  echo Set it with: setx SCHEDULED_SCAN_TOKEN "your_secret_token"
  echo Then restart your terminal and run this script again.
  pause
  exit /b 1
)

REM --- Create log directory ---
mkdir "%USERPROFILE%\VolumeTurtle\logs" 2>nul

set INSTALL_DIR=%~dp0..
if "!INSTALL_DIR:~-1!"=="\" set INSTALL_DIR=!INSTALL_DIR:~0,-1!

REM --- LSE Scan: 17:30 weekdays ---
schtasks /create /tn "VolumeTurtle_Scan_LSE" ^
  /tr "cmd /c \"!INSTALL_DIR!\scripts\run-scan.bat\"" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 17:30 ^
  /f

echo   LSE scan — every weekday at 17:30

REM --- US Scan: 22:00 weekdays ---
schtasks /create /tn "VolumeTurtle_Scan_US" ^
  /tr "cmd /c \"!INSTALL_DIR!\scripts\run-scan.bat\"" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 22:00 ^
  /f

echo   US scan  — every weekday at 22:00

REM --- Cruise Control: hourly 08:00-21:00 weekdays (covers LSE + US sessions) ---
schtasks /create /tn "VolumeTurtle_CruiseControl" ^
  /tr "cmd /c \"!INSTALL_DIR!\scripts\cruise-daemon.bat\"" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 08:00 ^
  /ri 60 ^
  /du 13:00 ^
  /f

echo   Cruise control — hourly 08:00-21:00 on weekdays

REM --- Execution Scheduler: every 5 min 08:00-21:00 weekdays ---
schtasks /create /tn "VolumeTurtle_ExecutionScheduler" ^
  /tr "cmd /c cd /d \"!INSTALL_DIR!\" && npx tsx scripts/executionScheduler.ts" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 08:00 ^
  /ri 5 ^
  /du 13:00 ^
  /f

echo   Execution scheduler — every 5 min 08:00-21:00 on weekdays

REM --- Universe Snapshot: Sunday 18:00 (markets closed, no live activity) ---
schtasks /create /tn "VolumeTurtle_UniverseSnapshot" ^
  /tr "cmd /c cd /d \"!INSTALL_DIR!\" && npx tsx scripts/snapshotUniverse.ts >> \"%USERPROFILE%\VolumeTurtle\logs\snapshot.log\" 2>&1" ^
  /sc weekly ^
  /d SUN ^
  /st 18:00 ^
  /f

echo   Universe snapshot — every Sunday at 18:00

REM --- Auto-Tune: Sunday 19:00 (after snapshot, before Mon trading) ---
schtasks /create /tn "VolumeTurtle_AutoTune" ^
  /tr "cmd /c cd /d \"!INSTALL_DIR!\" && npx tsx scripts/autoTune.ts --years 2 --notify >> \"%USERPROFILE%\VolumeTurtle\logs\autotune.log\" 2>&1" ^
  /sc weekly ^
  /d SUN ^
  /st 19:00 ^
  /f

echo   Auto-tune — every Sunday at 19:00 (writes data\recommendations\latest.json)
echo.

echo Done. Verifying tasks:
echo.
schtasks /query /tn "VolumeTurtle_Scan_LSE"
schtasks /query /tn "VolumeTurtle_Scan_US"
schtasks /query /tn "VolumeTurtle_CruiseControl"
schtasks /query /tn "VolumeTurtle_ExecutionScheduler"
schtasks /query /tn "VolumeTurtle_UniverseSnapshot"
schtasks /query /tn "VolumeTurtle_AutoTune"
echo.
echo To remove all tasks:
echo   schtasks /delete /tn "VolumeTurtle_Scan_LSE" /f
echo   schtasks /delete /tn "VolumeTurtle_Scan_US" /f
echo   schtasks /delete /tn "VolumeTurtle_CruiseControl" /f
echo   schtasks /delete /tn "VolumeTurtle_ExecutionScheduler" /f
echo   schtasks /delete /tn "VolumeTurtle_UniverseSnapshot" /f
echo   schtasks /delete /tn "VolumeTurtle_AutoTune" /f
pause
