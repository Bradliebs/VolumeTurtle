@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ─────────────────────────────────────────────────────────
::  VolumeTurtle — First-Time Installer
::
::  Run this ONCE to set up everything.
::  After that, use START.bat for daily use.
::
::  This script:
::   1. Checks you have Node.js and Docker installed
::   2. Sets up your configuration (.env)
::   3. Starts the database (PostgreSQL via Docker)
::   4. Installs dependencies (npm install)
::   5. Sets up the database tables (Prisma)
::   6. Sets up automatic scheduled tasks
::   7. Starts the app and opens your browser
::
::  If anything fails, it tells you exactly what to do.
:: ─────────────────────────────────────────────────────────

title VolumeTurtle — Installer

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║     VolumeTurtle — First-Time Setup       ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: ─────────────────────────────────────────
:: Step 1: Check Node.js
:: ─────────────────────────────────────────
echo  [1/7] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ╔═══════════════════════════════════════════╗
  echo  ║  Node.js is NOT installed.                ║
  echo  ║                                           ║
  echo  ║  Please install it first:                 ║
  echo  ║  https://nodejs.org/en/download           ║
  echo  ║                                           ║
  echo  ║  Download the LTS version, run the        ║
  echo  ║  installer, then re-run this script.      ║
  echo  ╚═══════════════════════════════════════════╝
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo         Found Node.js %NODE_VER%

:: Check Node.js version is 18+
for /f "tokens=1 delims=." %%m in ("%NODE_VER:~1%") do set NODE_MAJOR=%%m
if !NODE_MAJOR! lss 18 (
  echo.
  echo  ╔═══════════════════════════════════════════╗
  echo  ║  Node.js %NODE_VER% is too old.              ║
  echo  ║                                           ║
  echo  ║  VolumeTurtle requires Node.js 18 or      ║
  echo  ║  newer. Please update:                    ║
  echo  ║  https://nodejs.org/en/download           ║
  echo  ║                                           ║
  echo  ║  Download the LTS version, install it     ║
  echo  ║  over the old one, then re-run this.      ║
  echo  ╚═══════════════════════════════════════════╝
  echo.
  pause
  exit /b 1
)

:: ─────────────────────────────────────────
:: Step 2: Check Docker
:: ─────────────────────────────────────────
echo  [2/7] Checking Docker...
where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ╔═══════════════════════════════════════════╗
  echo  ║  Docker is NOT installed.                 ║
  echo  ║                                           ║
  echo  ║  Please install Docker Desktop:           ║
  echo  ║  https://www.docker.com/products/         ║
  echo  ║          docker-desktop                   ║
  echo  ║                                           ║
  echo  ║  Install it, start Docker Desktop,        ║
  echo  ║  wait for it to finish loading,           ║
  echo  ║  then re-run this script.                 ║
  echo  ╚═══════════════════════════════════════════╝
  echo.
  pause
  exit /b 1
)
echo         Found Docker

:: Check Docker is actually running
docker info >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ╔═══════════════════════════════════════════╗
  echo  ║  Docker is installed but NOT running.     ║
  echo  ║                                           ║
  echo  ║  Open Docker Desktop and wait for it      ║
  echo  ║  to say "Docker is running", then         ║
  echo  ║  re-run this script.                      ║
  echo  ╚═══════════════════════════════════════════╝
  echo.
  pause
  exit /b 1
)
echo         Docker is running

:: ─────────────────────────────────────────
:: Step 3: Create .env if missing
:: ─────────────────────────────────────────
echo  [3/7] Setting up configuration...
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo         Created .env from template
    echo         You can edit .env later to customise settings.
  ) else (
    echo.
    echo  ERROR: .env.example is missing from the project.
    echo  The repository may be incomplete. Re-download and try again.
    pause
    exit /b 1
  )
) else (
  echo         .env already exists, keeping it
)

:: ─────────────────────────────────────────
:: Step 4: Start database
:: ─────────────────────────────────────────
echo  [4/7] Starting database...
docker compose up -d 2>nul
if not errorlevel 1 goto db_started
docker-compose up -d 2>nul
if not errorlevel 1 goto db_started
echo.
echo  ERROR: Could not start the database.
echo  Make sure Docker Desktop is fully loaded and try again.
pause
exit /b 1

:db_started

:: Wait for database to be ready (max 60s)
echo         Waiting for PostgreSQL to be ready...
set RETRIES=0
:wait_db
set /a RETRIES+=1
if !RETRIES! gtr 60 (
  echo.
  echo  ERROR: Database did not start within 60 seconds.
  echo  Open Docker Desktop and check the volumeturtle-db container for errors.
  pause
  exit /b 1
)
docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait_db
)
echo         Database is ready

:: ─────────────────────────────────────────
:: Step 5: Install dependencies + setup DB
:: ─────────────────────────────────────────
echo  [5/7] Installing dependencies (this may take 1-2 minutes)...
call npm install --loglevel=error
if errorlevel 1 (
  echo.
  echo  ERROR: npm install failed.
  echo  Check your internet connection and try again.
  pause
  exit /b 1
)
echo         Dependencies installed

echo         Generating Prisma client...
call npx prisma generate
if errorlevel 1 (
  echo.
  echo  ERROR: Prisma client generation failed.
  echo  Check the output above for details.
  pause
  exit /b 1
)

echo         Creating database tables...
call npx prisma db push
if errorlevel 1 (
  echo.
  echo  ERROR: Database schema push failed.
  echo  Make sure the database is running (check Docker Desktop).
  pause
  exit /b 1
)
echo         Database tables created

:: ─────────────────────────────────────────
:: Step 6: Set up scheduled tasks
:: ─────────────────────────────────────────
echo  [6/7] Setting up automatic scheduled tasks...
set SCHED_OK=0
set SCHED_FAIL=0
set INSTALL_DIR=%~dp0
:: Remove trailing backslash for clean paths
if "%INSTALL_DIR:~-1%"=="\" set INSTALL_DIR=%INSTALL_DIR:~0,-1%

:: --- LSE Scan: 17:30 weekdays (catches London signals after market close) ---
schtasks /create /tn "VolumeTurtle_Scan_LSE" ^
  /tr "cmd /c \"%INSTALL_DIR%\scripts\run-scan.bat\"" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 17:30 ^
  /f >nul 2>nul
if errorlevel 1 (
  set /a SCHED_FAIL+=1
  echo         [!] Could not create LSE scan task
) else (
  set /a SCHED_OK+=1
  echo         LSE scan — every weekday at 17:30
)

:: --- US Scan: 22:00 weekdays (catches US signals after market close) ---
schtasks /create /tn "VolumeTurtle_Scan_US" ^
  /tr "cmd /c \"%INSTALL_DIR%\scripts\run-scan.bat\"" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 22:00 ^
  /f >nul 2>nul
if errorlevel 1 (
  set /a SCHED_FAIL+=1
  echo         [!] Could not create US scan task
) else (
  set /a SCHED_OK+=1
  echo         US scan  — every weekday at 22:00
)

:: --- Cruise Control: hourly 08:00-17:00 weekdays (trailing stop updates) ---
schtasks /create /tn "VolumeTurtle_CruiseControl" ^
  /tr "cmd /c \"%INSTALL_DIR%\scripts\cruise-daemon.bat\"" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 08:00 ^
  /ri 60 ^
  /du 09:00 ^
  /f >nul 2>nul
if errorlevel 1 (
  set /a SCHED_FAIL+=1
  echo         [!] Could not create Cruise Control task
) else (
  set /a SCHED_OK+=1
  echo         Cruise control — hourly 08:00-17:00 on weekdays
)

:: --- Execution Scheduler: every 1 min 14:00-20:00 weekdays (process pending orders) ---
schtasks /create /tn "VolumeTurtle_ExecutionScheduler" ^
  /tr "cmd /c cd /d \"%INSTALL_DIR%\" && npx tsx scripts/executionScheduler.ts" ^
  /sc weekly ^
  /d MON,TUE,WED,THU,FRI ^
  /st 14:00 ^
  /ri 5 ^
  /du 06:00 ^
  /f >nul 2>nul
if errorlevel 1 (
  set /a SCHED_FAIL+=1
  echo         [!] Could not create Execution Scheduler task
) else (
  set /a SCHED_OK+=1
  echo         Execution scheduler — every 5 min 14:00-20:00 on weekdays
)

if !SCHED_FAIL! gtr 0 (
  echo.
  echo  ╔═══════════════════════════════════════════╗
  echo  ║  Some scheduled tasks could not be        ║
  echo  ║  created. This usually means you need     ║
  echo  ║  to run as Administrator.                 ║
  echo  ║                                           ║
  echo  ║  To fix this:                             ║
  echo  ║   1. Close this window                    ║
  echo  ║   2. Right-click INSTALL.bat              ║
  echo  ║   3. Click "Run as administrator"         ║
  echo  ║                                           ║
  echo  ║  Everything else installed fine.           ║
  echo  ║  Only the automatic scans need this.      ║
  echo  ╚═══════════════════════════════════════════╝
  echo.
)

:: ─────────────────────────────────────────
:: Step 6b: Set up agent scheduled tasks
:: ─────────────────────────────────────────
echo  [6b/7] Setting up AI agent scheduled tasks...
echo         (These are optional — agent requires ANTHROPIC_API_KEY in .env)
call npx tsx scripts/schedule-agent.ts setup >nul 2>nul
if errorlevel 1 (
  echo         [!] Could not create agent tasks — run "npm run schedule:agent:setup" manually
) else (
  echo         Agent tasks created (hourly cycle, Telegram listener, Sunday/Friday runners)
)

:: ─────────────────────────────────────────
:: Step 7: Start the app
:: ─────────────────────────────────────────
echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║                                           ║
echo  ║   Setup complete! Starting VolumeTurtle   ║
echo  ║                                           ║
echo  ╠═══════════════════════════════════════════╣
echo  ║                                           ║
echo  ║   Your browser will open automatically.   ║
echo  ║   If not, go to: http://localhost:3000    ║
echo  ║                                           ║
echo  ║   Press Ctrl+C in this window to stop.    ║
echo  ║                                           ║
echo  ╠═══════════════════════════════════════════╣
echo  ║                                           ║
echo  ║   AUTOMATIC SCANS SET UP:                 ║
echo  ║                                           ║
echo  ║   - LSE scan runs at 17:30 (weekdays)     ║
echo  ║   - US  scan runs at 22:00 (weekdays)     ║
echo  ║   - Stops updated hourly 08:00-17:00      ║
echo  ║   - Execution scheduler 14:00-20:00       ║
echo  ║                                           ║
echo  ║   AI AGENT (if ANTHROPIC_API_KEY set):     ║
echo  ║   - Agent cycle hourly 08:00-21:00        ║
echo  ║   - Telegram listener every 2 min         ║
echo  ║   - Sunday snapshot + auto-tune           ║
echo  ║   - Friday weekly debrief                 ║
echo  ║                                           ║
echo  ║   These run automatically as long as      ║
echo  ║   your computer is on and logged in.      ║
echo  ║   You do NOT need this window open.       ║
echo  ║                                           ║
echo  ╠═══════════════════════════════════════════╣
echo  ║                                           ║
echo  ║   DAILY USE:                              ║
echo  ║   Double-click START.bat to open the      ║
echo  ║   dashboard whenever you want to check    ║
echo  ║   signals, positions, or trades.          ║
echo  ║                                           ║
echo  ║   TO UNINSTALL:                           ║
echo  ║   Double-click UNINSTALL.bat to remove    ║
echo  ║   scheduled tasks and stop the database.  ║
echo  ║                                           ║
echo  ║   TO REMOVE AUTOMATIC SCANS:              ║
echo  ║   Run these commands in a terminal:       ║
echo  ║   schtasks /delete /tn                    ║
echo  ║     "VolumeTurtle_Scan_LSE" /f            ║
echo  ║   schtasks /delete /tn                    ║
echo  ║     "VolumeTurtle_Scan_US" /f             ║
echo  ║   schtasks /delete /tn                    ║
echo  ║     "VolumeTurtle_CruiseControl" /f       ║
echo  ║   schtasks /delete /tn                    ║
echo  ║     "VolumeTurtle_ExecutionScheduler" /f  ║
echo  ║                                           ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Open browser once server is ready (polls until localhost:3000 responds, max 60s)
start "" powershell -NoProfile -Command "$i=0; while($i -lt 30){Start-Sleep 2; $i++; try{Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null; Start-Process http://localhost:3000; exit}catch{}}; Start-Process http://localhost:3000"

:: Start the dev server (keeps this window open)
call npx next dev
