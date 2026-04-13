@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ─────────────────────────────────────────────────────────
::  VolumeTurtle — First-Time Installer (One-Click)
::
::  Just double-click this file. Everything is automatic.
::  After install, use START.bat for daily use.
:: ─────────────────────────────────────────────────────────

title VolumeTurtle — Installer

:: ─── Auto-elevate to Administrator ──────────────────────
net session >nul 2>&1
if not errorlevel 1 goto :is_admin
echo  Requesting administrator access...
powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath \"%~f0\""
if errorlevel 1 (
  echo.
  echo  Administrator access is required to install VolumeTurtle.
  echo  Please click Yes when the admin prompt appears.
  pause
  exit /b 1
)
exit /b
:is_admin
:: Re-set working directory (UAC elevation resets to System32)
cd /d "%~dp0"

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
:: Step 3: Create .env with auto-generated tokens
:: ─────────────────────────────────────────
echo  [3/7] Setting up configuration...
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo         Created .env from template
  ) else (
    echo.
    echo  ERROR: .env.example is missing from the project.
    echo  The repository may be incomplete. Re-download and try again.
    pause
    exit /b 1
  )
) else (
  echo         .env already exists
)

:: Generate tokens if placeholders are still present (handles fresh install AND partial re-runs)
findstr /C:"choose-a-long-random-string-here" .env >nul 2>nul
if not errorlevel 1 (
  :: Generate a secure random SCHEDULED_SCAN_TOKEN (CSPRNG)
  for /f "tokens=*" %%t in ('powershell -NoProfile -Command "$b=New-Object byte[] 24;$r=[System.Security.Cryptography.RandomNumberGenerator]::Create();$r.GetBytes($b);[Convert]::ToBase64String($b) -replace '[+/=]',''"') do set SCAN_TOKEN=%%t
  if not defined SCAN_TOKEN (
    echo.
    echo  ERROR: Could not generate a security token.
    echo  Make sure PowerShell is available and try again.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "(Get-Content '.env') -replace 'choose-a-long-random-string-here','!SCAN_TOKEN!' | Set-Content '.env'"
  echo         Generated SCHEDULED_SCAN_TOKEN
  :: Set SCHEDULED_SCAN_TOKEN as a system environment variable (for Task Scheduler)
  setx /M SCHEDULED_SCAN_TOKEN "!SCAN_TOKEN!"
  if errorlevel 1 (
    echo         [!] WARNING: Could not set system env var.
    echo         Scheduled scans may need manual SCHEDULED_SCAN_TOKEN setup.
  ) else (
    echo         Set SCHEDULED_SCAN_TOKEN system variable
  )
)
findstr /C:"change-me-or-auto-generated" .env >nul 2>nul
if not errorlevel 1 (
  :: Generate a secure random DASHBOARD_TOKEN (CSPRNG)
  for /f "tokens=*" %%t in ('powershell -NoProfile -Command "$b=New-Object byte[] 16;$r=[System.Security.Cryptography.RandomNumberGenerator]::Create();$r.GetBytes($b);[Convert]::ToBase64String($b) -replace '[+/=]',''"') do set DASH_GEN=%%t
  if defined DASH_GEN (
    powershell -NoProfile -Command "(Get-Content '.env') -replace 'change-me-or-auto-generated','!DASH_GEN!' | Set-Content '.env'"
    echo         Generated DASHBOARD_TOKEN
  ) else (
    echo         [!] Could not generate dashboard token — using default
  )
)

:: ─────────────────────────────────────────
:: Step 4: Start database (clean up stale containers first)
:: ─────────────────────────────────────────
echo  [4/7] Starting database...
echo         Cleaning up any stale containers...
docker compose down >nul 2>nul
docker-compose down >nul 2>nul
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
  /ri 1 ^
  /du 06:00 ^
  /f >nul 2>nul
if errorlevel 1 (
  set /a SCHED_FAIL+=1
  echo         [!] Could not create Execution Scheduler task
) else (
  set /a SCHED_OK+=1
  echo         Execution scheduler — every minute 14:00-20:00 on weekdays
)

if !SCHED_FAIL! gtr 0 (
  echo.
  echo         [!] Some scheduled tasks failed.
  echo         Try: Right-click INSTALL.bat and select Run as administrator
  echo.
)

:: ─────────────────────────────────────────
:: Step 7: Start the app
:: ─────────────────────────────────────────
:: Read DASHBOARD_TOKEN from .env for the banner
for /f "tokens=1,* delims==" %%a in ('findstr /B "DASHBOARD_TOKEN" .env') do set DASH_TOKEN=%%b

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║                                           ║
echo  ║   Setup complete! Starting VolumeTurtle   ║
echo  ║                                           ║
echo  ╠═══════════════════════════════════════════╣
echo  ║                                           ║
echo  ║   LOGIN TOKEN:  !DASH_TOKEN!              ║
echo  ║                                           ║
echo  ║   Type this token into the login screen   ║
echo  ║   when your browser opens.                ║
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
echo  ╚═══════════════════════════════════════════╝
echo.

:: Open browser once server is ready
start "" cmd /c "timeout /t 8 /nobreak >nul && start http://localhost:3000"

:: Start the dev server (keeps this window open)
call npx next dev
