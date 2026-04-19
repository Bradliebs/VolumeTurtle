@echo off
:: ─────────────────────────────────────────────────────────
::  VolumeTurtle DB Cleanup
::
::  Calls POST /api/internal/cleanup to remove stale rows.
::  Designed to run via Task Scheduler daily at 06:00.
:: ─────────────────────────────────────────────────────────
cd /d "%~dp0\.."

set LOGDIR=%USERPROFILE%\VolumeTurtle\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

for /f "tokens=*" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set TS=%%t

:: Load DASHBOARD_TOKEN from .env.local
for /f "tokens=1,* delims==" %%a in ('findstr /i "DASHBOARD_TOKEN" .env.local 2^>nul') do set DASHBOARD_TOKEN=%%b

if "%DASHBOARD_TOKEN%"=="" (
    echo [%TS%] ERROR: DASHBOARD_TOKEN not found in .env.local >> "%LOGDIR%\cleanup.log"
    exit /b 1
)

curl -s -X POST http://localhost:3000/api/internal/cleanup -H "Authorization: Bearer %DASHBOARD_TOKEN%" -H "Content-Type: application/json" >> "%LOGDIR%\cleanup.log" 2>&1
echo. >> "%LOGDIR%\cleanup.log"
echo [%TS%] Cleanup complete >> "%LOGDIR%\cleanup.log"
