@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ─────────────────────────────────────────────────────────
::  VolumeTurtle — Daily Start
::
::  Run this each time you want to use the app.
::  (Run INSTALL.bat first if this is your first time.)
:: ─────────────────────────────────────────────────────────

title VolumeTurtle

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║        VolumeTurtle — Starting...         ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: ─────────────────────────────────────────
:: Step 1: Check Docker is running
:: ─────────────────────────────────────────
echo  [1/3] Checking Docker...
docker info >nul 2>nul
if not errorlevel 1 goto docker_ok

echo         Docker is not running. Trying to start it...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
echo         Waiting for Docker to start (this can take 30-60 seconds)...
set DC_RETRIES=0

:wait_docker
set /a DC_RETRIES+=1
if !DC_RETRIES! gtr 90 (
  echo.
  echo  ERROR: Docker did not start within 90 seconds.
  echo  Please open Docker Desktop manually, wait for it to load,
  echo  then re-run this script.
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait_docker
)

:docker_ok
echo         Docker is running

:: ─────────────────────────────────────────
:: Step 2: Start database
:: ─────────────────────────────────────────
echo  [2/3] Starting database...
docker compose up -d 2>nul
if not errorlevel 1 goto db_started
docker-compose up -d 2>nul
if not errorlevel 1 goto db_started
echo.
echo  ERROR: Could not start the database container.
echo  Open Docker Desktop and check for errors.
pause
exit /b 1

:db_started
:: Wait for database to be ready (max 60s)
echo         Waiting for PostgreSQL...
set RETRIES=0

:wait_db
set /a RETRIES+=1
if !RETRIES! gtr 60 (
  echo.
  echo  ERROR: Database did not start within 60 seconds.
  echo  Open Docker Desktop and check the volumeturtle-db container.
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
:: Step 3: Start the app
:: ─────────────────────────────────────────
echo  [3/3] Starting VolumeTurtle...

:: Kill any stale node processes on port 3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
  taskkill /F /PID %%p >nul 2>nul
)

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║                                           ║
echo  ║   Your browser will open automatically.   ║
echo  ║   If not, go to: http://localhost:3000    ║
echo  ║                                           ║
echo  ║   Press Ctrl+C in this window to stop.    ║
echo  ║                                           ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Open browser once server is ready (polls until localhost:3000 responds)
start "" powershell -NoProfile -Command "$i=0; while($i -lt 30){Start-Sleep 2; $i++; try{Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null; Start-Process http://localhost:3000; exit}catch{}}; Start-Process http://localhost:3000"

:: Start the dev server (keeps this window open)
call npx next dev
