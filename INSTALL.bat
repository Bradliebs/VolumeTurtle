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
::   6. Starts the app and opens your browser
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
echo  [3/6] Setting up configuration...
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
echo  [4/6] Starting database...
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
echo  [5/6] Installing dependencies (this may take 1-2 minutes)...
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
:: Step 6: Start the app
:: ─────────────────────────────────────────
echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║                                           ║
echo  ║   Setup complete! Starting VolumeTurtle   ║
echo  ║                                           ║
echo  ║   Your browser will open automatically.   ║
echo  ║   If not, go to: http://localhost:3000    ║
echo  ║                                           ║
echo  ║   Press Ctrl+C in this window to stop.    ║
echo  ║                                           ║
echo  ║   Next time, just use START.bat           ║
echo  ║                                           ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Open browser once server is ready
start "" cmd /c "timeout /t 8 /nobreak >nul && start http://localhost:3000"

:: Start the dev server (keeps this window open)
call npx next dev
