@echo off
cd /d "%~dp0\.."
if not exist "logs" mkdir logs
call npx tsx scripts/cruise-daemon.ts >> logs\cruise-daemon.log 2>&1
