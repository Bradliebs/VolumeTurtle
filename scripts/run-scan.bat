@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

:: ─────────────────────────────────────────────────────────
::  VolumeTurtle — Nightly Scan (Self-Contained)
::
::  This script is designed to run from Windows Task Scheduler.
::  It handles Docker, database, and scan execution automatically.
::  Output is logged to logs\nightly-scan.log
:: ─────────────────────────────────────────────────────────

if not exist "logs" mkdir logs

:: Timestamp for log
for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set TS=%%d
echo. >> logs\nightly-scan.log
echo ────────────────────────────────────── >> logs\nightly-scan.log
echo [%TS%] Scan starting... >> logs\nightly-scan.log

:: ─────────────────────────────────────────
:: Step 1: Ensure Docker is running
:: ─────────────────────────────────────────
docker info >nul 2>nul
if not errorlevel 1 goto docker_ok

echo [%TS%] Docker not running. Starting Docker Desktop... >> logs\nightly-scan.log
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
set DC_RETRIES=0

:wait_docker
set /a DC_RETRIES+=1
if !DC_RETRIES! gtr 90 (
  echo [%TS%] ERROR: Docker did not start within 90 seconds. >> logs\nightly-scan.log
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait_docker
)

:docker_ok
echo [%TS%] Docker is running >> logs\nightly-scan.log

:: ─────────────────────────────────────────
:: Step 2: Start database container
:: ─────────────────────────────────────────
docker compose up -d >nul 2>nul
if not errorlevel 1 goto db_started
docker-compose up -d >nul 2>nul
if not errorlevel 1 goto db_started
echo [%TS%] ERROR: Could not start database container. >> logs\nightly-scan.log
exit /b 1

:db_started

:: Wait for PostgreSQL to be ready (max 60s)
set RETRIES=0

:wait_db
set /a RETRIES+=1
if !RETRIES! gtr 60 (
  echo [%TS%] ERROR: Database not ready within 60 seconds. >> logs\nightly-scan.log
  exit /b 1
)
docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait_db
)
echo [%TS%] Database is ready >> logs\nightly-scan.log

:: ─────────────────────────────────────────
:: Step 3: Run the scan
:: ─────────────────────────────────────────
echo [%TS%] Running nightly scan... >> logs\nightly-scan.log
call npx tsx scripts/nightlyScan.ts >> logs\nightly-scan.log 2>&1
set SCAN_EXIT=%ERRORLEVEL%

for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set TS2=%%d
if %SCAN_EXIT% equ 0 (
  echo [%TS2%] Scan completed successfully. >> logs\nightly-scan.log
) else (
  echo [%TS2%] Scan exited with code %SCAN_EXIT%. >> logs\nightly-scan.log
)
exit /b %SCAN_EXIT%
