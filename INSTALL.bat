@echo off
setlocal enabledelayedexpansion

:: ─────────────────────────────────────────────────────────
::  TradeCore — One-Click Installer
::  
::  This script:
::   1. Checks you have Node.js and Docker installed
::   2. Starts the database (PostgreSQL via Docker)
::   3. Installs dependencies (npm install)
::   4. Sets up the database tables
::   5. Starts the app
::
::  If anything fails, it tells you exactly what to do.
:: ─────────────────────────────────────────────────────────

title TradeCore Installer

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║       TradeCore — One-Click Setup         ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: ─────────────────────────────────────────
:: Step 1: Check Node.js
:: ─────────────────────────────────────────
echo  [1/6] Checking Node.js...
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
echo  [2/6] Checking Docker...
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

:: Check Docker is running
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
echo  [3/6] Setting up configuration...
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo         Created .env from template
  ) else (
    echo         WARNING: No .env.example found, creating minimal .env
    (
      echo DATABASE_URL=postgresql://postgres:postgres@localhost:5433/volume_turtle
      echo VOLUME_TURTLE_BALANCE=1000
      echo MAX_POSITIONS=5
      echo RISK_PER_TRADE_PCT=2
      echo SCHEDULED_SCAN_TOKEN=tradecore-local-token-change-me
    ) > ".env"
  )
) else (
  echo         .env already exists, keeping it
)

:: ─────────────────────────────────────────
:: Step 4: Start database
:: ─────────────────────────────────────────
echo  [4/6] Starting database...
docker compose up -d 2>nul
if errorlevel 1 (
  docker-compose up -d 2>nul
  if errorlevel 1 (
    echo.
    echo  ERROR: Could not start the database.
    echo  Make sure Docker Desktop is running and try again.
    pause
    exit /b 1
  )
)

:: Wait for database to be ready
echo         Waiting for PostgreSQL to start...
set RETRIES=0
:wait_db
set /a RETRIES+=1
if %RETRIES% gtr 30 (
  echo         ERROR: Database did not start in 30 seconds.
  echo         Check Docker Desktop for errors.
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
echo  [5/6] Installing dependencies (this takes 1-2 minutes)...
call npm install --loglevel=error
if errorlevel 1 (
  echo.
  echo  ERROR: npm install failed.
  echo  Check your internet connection and try again.
  pause
  exit /b 1
)
echo         Dependencies installed

echo         Setting up database tables...
call npx prisma generate >nul 2>nul
call npx prisma db push --accept-data-loss >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ERROR: Database setup failed.
  echo  Make sure the database is running (check Docker Desktop).
  pause
  exit /b 1
)
echo         Database tables created

:: ─────────────────────────────────────────
:: Step 6: Start the app
:: ─────────────────────────────────────────
echo  [6/6] Starting TradeCore...
echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║                                           ║
echo  ║   TradeCore is starting!                  ║
echo  ║                                           ║
echo  ║   Open your browser to:                   ║
echo  ║   http://localhost:3000                    ║
echo  ║                                           ║
echo  ║   Press Ctrl+C in this window to stop.    ║
echo  ║                                           ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Open browser automatically after a short delay
start "" cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3000"

:: Start the dev server (keeps this window open)
call npx next dev
