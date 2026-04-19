@echo off
:: ─────────────────────────────────────────────────────────
::  VolumeTurtle Watchdog
::
::  Checks if the dev server is responding on localhost:3000.
::  If not, kills any stale node processes and restarts it.
::
::  Designed to run via Task Scheduler every 5 minutes during
::  market hours (08:00–21:00 weekdays).
::
::  Log output goes to %USERPROFILE%\VolumeTurtle\logs\watchdog.log
:: ─────────────────────────────────────────────────────────
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

set LOGDIR=%USERPROFILE%\VolumeTurtle\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOGFILE=%LOGDIR%\watchdog.log

:: Timestamp
for /f "tokens=*" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set TS=%%t

:: Health check — try to reach the dashboard API
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/dashboard' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>nul

if not errorlevel 1 (
    echo [%TS%] OK — dev server responding >> "%LOGFILE%"
    exit /b 0
)

echo [%TS%] DOWN — dev server not responding. Restarting... >> "%LOGFILE%"

:: Kill any stale node processes on port 3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
    echo [%TS%] Killing stale process PID %%p >> "%LOGFILE%"
    taskkill /F /PID %%p >nul 2>nul
)

:: Also kill any orphaned node.exe that might be holding resources
:: (only those running from this project directory)
taskkill /F /IM node.exe /FI "WINDOWTITLE eq VolumeTurtle*" >nul 2>nul

:: Check Docker/DB are up (skip restart if DB is down — START.bat handles that)
docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
if errorlevel 1 (
    echo [%TS%] Database is not running — attempting docker compose up >> "%LOGFILE%"
    docker compose up -d >nul 2>nul
    timeout /t 10 /nobreak >nul
    docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
    if errorlevel 1 (
        echo [%TS%] Database still down — cannot restart dev server. Manual intervention needed. >> "%LOGFILE%"
        exit /b 1
    )
    echo [%TS%] Database recovered >> "%LOGFILE%"
)

:: Regenerate Prisma client (idempotent, fast)
call npx prisma generate >nul 2>nul

:: Start dev server in a new minimized window so it persists
start "VolumeTurtle" /min cmd /c "cd /d "%~dp0\.." && npx next dev >> "%LOGDIR%\devserver.log" 2>&1"

:: Wait for it to come up (max 30s)
set RETRIES=0
:wait_server
set /a RETRIES+=1
if !RETRIES! gtr 15 (
    echo [%TS%] FAILED — dev server did not start within 30 seconds >> "%LOGFILE%"
    exit /b 1
)
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 goto wait_server

echo [%TS%] RECOVERED — dev server restarted successfully >> "%LOGFILE%"
exit /b 0
