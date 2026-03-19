@echo off
cd /d "%~dp0"

echo [1/4] Copying .env from .env.example...
if not exist .env (
    copy .env.example .env
    echo       Created .env
) else (
    echo       .env already exists — skipping
)

echo [2/4] Starting Postgres via Docker...
docker compose up -d
if %errorlevel% neq 0 (
    echo       ERROR: Docker failed. Is Docker Desktop running?
    pause
    exit /b 1
)

echo [3/4] Waiting for Postgres to be ready...
echo       Waiting for healthcheck...
:wait_loop
docker inspect --format="{{.State.Health.Status}}" volumeturtle-db 2>nul | findstr "healthy" >nul
if %errorlevel% neq 0 (
    timeout /t 2 /nobreak >nul
    goto wait_loop
)
echo       Postgres is ready.

echo [4/4] Pushing schema to database...
call npx prisma db push
if %errorlevel% neq 0 (
    echo       ERROR: prisma db push failed.
    pause
    exit /b 1
)

echo.
echo ======================================
echo   VolumeTurtle setup complete!
echo   Run scan.bat to start scanning.
echo   Run dev.bat to start the dashboard.
echo ======================================
echo.
pause
