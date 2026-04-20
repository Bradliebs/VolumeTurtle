@echo off
:: ─────────────────────────────────────────────────────────
::  VolumeTurtle Watchdog
::
::  1. Pings TRADECORE_BASE_URL/api/health with auth header.
::  2. If unreachable: kills stale node, restarts dev server inline
::     (NOT START.bat — START.bat has interactive `pause` paths
::     that would hang an unattended scheduled task).
::  3. Waits up to 30s, pings /api/health again.
::  4. If still down: sends Telegram alert and exits non-zero so
::     downstream Task Scheduler tasks (agent, executor) can detect.
::
::  Designed to run via Task Scheduler every 5 minutes during
::  market hours (08:00-21:00 weekdays) and BEFORE every agent task.
::
::  Log output: %USERPROFILE%\VolumeTurtle\logs\watchdog.log
:: ─────────────────────────────────────────────────────────
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

set LOGDIR=%USERPROFILE%\VolumeTurtle\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOGFILE=%LOGDIR%\watchdog.log

:: Timestamp
for /f "tokens=*" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set TS=%%t

:: Load .env values we need (DASHBOARD_TOKEN, TRADECORE_BASE_URL,
:: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) without sourcing the whole file.
set "DASHBOARD_TOKEN="
set "TRADECORE_BASE_URL="
set "TELEGRAM_BOT_TOKEN="
set "TELEGRAM_CHAT_ID="
if exist .env (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="DASHBOARD_TOKEN"    set "DASHBOARD_TOKEN=%%b"
    if /i "%%a"=="TRADECORE_BASE_URL" set "TRADECORE_BASE_URL=%%b"
    if /i "%%a"=="TELEGRAM_BOT_TOKEN" set "TELEGRAM_BOT_TOKEN=%%b"
    if /i "%%a"=="TELEGRAM_CHAT_ID"   set "TELEGRAM_CHAT_ID=%%b"
  )
)
if "%TRADECORE_BASE_URL%"=="" set "TRADECORE_BASE_URL=http://localhost:3000"

set "HEALTH_URL=%TRADECORE_BASE_URL%/api/health"

:: ── Health check #1 ──
call :ping_health
if not errorlevel 1 (
    echo [%TS%] OK — %HEALTH_URL% responding >> "%LOGFILE%"
    exit /b 0
)

echo [%TS%] DOWN — %HEALTH_URL% not responding. Restarting... >> "%LOGFILE%"

:: Kill any stale node processes on port 3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
    echo [%TS%] Killing stale process PID %%p >> "%LOGFILE%"
    taskkill /F /PID %%p >nul 2>nul
)

:: Also kill any orphaned node.exe that might be holding resources
:: (only those running from this project directory)
taskkill /F /IM node.exe /FI "WINDOWTITLE eq VolumeTurtle*" >nul 2>nul

:: Check Docker/DB are up
docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
if errorlevel 1 (
    echo [%TS%] Database is not running — attempting docker compose up >> "%LOGFILE%"
    docker compose up -d >nul 2>nul
    timeout /t 10 /nobreak >nul
    docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
    if errorlevel 1 (
        echo [%TS%] Database still down — cannot restart dev server. >> "%LOGFILE%"
        call :alert_down "Database container down — dev server not restarted"
        exit /b 1
    )
    echo [%TS%] Database recovered >> "%LOGFILE%"
)

:: Regenerate Prisma client (idempotent, fast)
call npx prisma generate >nul 2>nul

:: Start dev server in a new minimized window so it persists.
:: Inline `npx next dev` is used (NOT START.bat) because START.bat
:: contains interactive `pause` paths that would hang the watchdog.
start "VolumeTurtle" /min cmd /c "cd /d "%~dp0\.." && npx next dev >> "%LOGDIR%\devserver.log" 2>&1"

:: Wait up to 30s for server to come up (15 retries × 2s)
set RETRIES=0
:wait_server
set /a RETRIES+=1
if !RETRIES! gtr 15 (
    echo [%TS%] FAILED — dev server did not respond within 30 seconds >> "%LOGFILE%"
    call :alert_down "Dev server did not come up within 30s after restart"
    exit /b 1
)
timeout /t 2 /nobreak >nul
call :ping_health
if errorlevel 1 goto wait_server

echo [%TS%] RECOVERED — dev server restarted and /api/health responding >> "%LOGFILE%"
exit /b 0

:: ─────────────────────────────────────────────────────────
:: :ping_health — exits 0 if /api/health returns 200, else 1
:: Uses DASHBOARD_TOKEN bearer auth when set.
:: ─────────────────────────────────────────────────────────
:ping_health
if "%DASHBOARD_TOKEN%"=="" (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
) else (
  powershell -NoProfile -Command "try { $h = @{ Authorization = 'Bearer %DASHBOARD_TOKEN%' }; $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -Headers $h -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
)
exit /b %errorlevel%

:: ─────────────────────────────────────────────────────────
:: :alert_down — sends a Telegram alert (best effort, non-blocking)
:: %~1 = reason text. Silent no-op if Telegram env vars are unset.
:: ─────────────────────────────────────────────────────────
:alert_down
if "%TELEGRAM_BOT_TOKEN%"=="" exit /b 0
if "%TELEGRAM_CHAT_ID%"=="" exit /b 0
set "WD_MSG=Dev server unreachable — agent tasks may fail. %~1"
powershell -NoProfile -Command "try { $body = @{ chat_id = '%TELEGRAM_CHAT_ID%'; text = ([char]0x26A0 + [char]0xFE0F + ' ' + $env:WD_MSG) } | ConvertTo-Json -Compress; Invoke-WebRequest -Uri 'https://api.telegram.org/bot%TELEGRAM_BOT_TOKEN%/sendMessage' -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop | Out-Null } catch { }" >nul 2>nul
echo [%TS%] Telegram alert sent: %~1 >> "%LOGFILE%"
exit /b 0
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
