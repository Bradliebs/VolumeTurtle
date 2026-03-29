@echo off

:: ─────────────────────────────────────────
::  TradeCore — Start (daily use)
::  Run this to start the app after installing.
:: ─────────────────────────────────────────

title TradeCore

echo.
echo  Starting TradeCore...
echo.

:: Start database if not running
docker compose up -d 2>nul
if errorlevel 1 (
  docker-compose up -d 2>nul
)

:: Wait for DB
:wait
docker exec volumeturtle-db pg_isready -U postgres -d volume_turtle >nul 2>nul
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)

:: Open browser after delay
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

echo  Database ready. Starting app...
echo  Open http://localhost:3000
echo  Press Ctrl+C to stop.
echo.

call npx next dev
