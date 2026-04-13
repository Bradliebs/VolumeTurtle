@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ─────────────────────────────────────────────────────────
::  VolumeTurtle — Uninstaller
::
::  Removes scheduled tasks, the system env var, and
::  optionally stops the database container.
::  Does NOT delete your data, .env, or project files.
:: ─────────────────────────────────────────────────────────

title VolumeTurtle — Uninstaller

:: ─── Auto-elevate to Administrator ──────────────────────
net session >nul 2>&1
if not errorlevel 1 goto :is_admin
echo  Requesting administrator access...
powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath \"%~f0\""
if errorlevel 1 (
  echo.
  echo  Administrator access is required to uninstall.
  echo  Please click Yes when the admin prompt appears.
  pause
  exit /b 1
)
exit /b
:is_admin
cd /d "%~dp0"

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║     VolumeTurtle — Uninstall              ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: ─────────────────────────────────────────
:: Step 1: Remove scheduled tasks
:: ─────────────────────────────────────────
echo  [1/3] Removing scheduled tasks...
set DEL_OK=0
set DEL_FAIL=0

for %%n in (
  "VolumeTurtle_Scan_LSE"
  "VolumeTurtle_Scan_US"
  "VolumeTurtle_CruiseControl"
  "VolumeTurtle_ExecutionScheduler"
) do (
  schtasks /delete /tn %%n /f >nul 2>nul
  if errorlevel 1 (
    set /a DEL_FAIL+=1
  ) else (
    set /a DEL_OK+=1
    echo         Removed %%~n
  )
)

if !DEL_OK!==0 if !DEL_FAIL! gtr 0 (
  echo         No scheduled tasks found — already removed or never created.
)

:: ─────────────────────────────────────────
:: Step 2: Remove system environment variable
:: ─────────────────────────────────────────
echo  [2/3] Removing SCHEDULED_SCAN_TOKEN system variable...
reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v SCHEDULED_SCAN_TOKEN /f >nul 2>nul
if errorlevel 1 (
  echo         Variable not found — already removed or never set.
) else (
  echo         Removed SCHEDULED_SCAN_TOKEN
)

:: ─────────────────────────────────────────
:: Step 3: Stop database container
:: ─────────────────────────────────────────
echo  [3/3] Stopping database container...
docker compose down >nul 2>nul
docker-compose down >nul 2>nul
echo         Database container stopped

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║                                           ║
echo  ║   Uninstall complete.                     ║
echo  ║                                           ║
echo  ║   Removed:                                ║
echo  ║   - Scheduled tasks (automatic scans)     ║
echo  ║   - SCHEDULED_SCAN_TOKEN system variable  ║
echo  ║   - Database container                    ║
echo  ║                                           ║
echo  ║   NOT removed:                            ║
echo  ║   - Your .env file and settings           ║
echo  ║   - Database data (Docker volume)         ║
echo  ║   - Project files and node_modules        ║
echo  ║                                           ║
echo  ║   To fully remove everything, delete      ║
echo  ║   this folder and run:                    ║
echo  ║   docker volume rm volumeturtle_pgdata    ║
echo  ║                                           ║
echo  ╚═══════════════════════════════════════════╝
echo.
pause
