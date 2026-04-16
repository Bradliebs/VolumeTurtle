@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

:: ─────────────────────────────────────────────────────────
::  VolumeTurtle — Midday Scan
::
::  Runs at 12:00 UTC (noon GMT) to detect yesterday's signals
::  and create pending orders for same-day execution during
::  the London/NY overlap (1-4 PM GMT).
::
::  The evening scans (17:30 LSE, 22:00 US) still run for
::  end-of-day signal detection — those orders execute next day.
:: ─────────────────────────────────────────────────────────

if not exist "logs" mkdir logs

:: Timestamp for log
for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set TS=%%d
echo. >> logs\midday-scan.log
echo ────────────────────────────────────── >> logs\midday-scan.log
echo [%TS%] Midday scan starting... >> logs\midday-scan.log

:: ─────────────────────────────────────────
:: Step 1: Ensure Docker is running
:: ─────────────────────────────────────────
docker info >nul 2>nul
if not errorlevel 1 goto docker_ok

echo [%TS%] Docker not running. Starting Docker Desktop... >> logs\midday-scan.log
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
set DC_RETRIES=0

:wait_docker
set /a DC_RETRIES+=1
if !DC_RETRIES! gtr 90 (
  echo [%TS%] ERROR: Docker did not start within 90 seconds. >> logs\midday-scan.log
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait_docker
)

:docker_ok
echo [%TS%] Docker is running >> logs\midday-scan.log

:: ─────────────────────────────────────────
:: Step 2: Start database container
:: ─────────────────────────────────────────
docker compose up -d >nul 2>nul
if not errorlevel 1 goto db_started
docker-compose up -d >nul 2>nul
if not errorlevel 1 goto db_started
echo [%TS%] ERROR: Could not start database container. >> logs\midday-scan.log
exit /b 1

:db_started

:: Wait for PostgreSQL to be ready (max 60s)
set RETRIES=0

:wait_db
set /a RETRIES+=1
if !RETRIES! gtr 60 (
  echo [%TS%] ERROR: Database not ready within 60 seconds. >> logs\midday-scan.log
  exit /b 1
)
docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait_db
)
echo [%TS%] Database is ready >> logs\midday-scan.log

:: ─────────────────────────────────────────
:: Step 3: Run the scan
:: ─────────────────────────────────────────
echo [%TS%] Running midday scan... >> logs\midday-scan.log
call npx tsx scripts/nightlyScan.ts >> logs\midday-scan.log 2>&1
set SCAN_EXIT=%ERRORLEVEL%

for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set TS2=%%d
if %SCAN_EXIT% equ 0 (
  echo [%TS2%] Midday scan completed successfully. >> logs\midday-scan.log
) else (
  echo [%TS2%] Midday scan exited with code %SCAN_EXIT%. >> logs\midday-scan.log
)
exit /b %SCAN_EXIT%
