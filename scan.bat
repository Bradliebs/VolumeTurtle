@echo off
cd /d "%~dp0"
call npx tsx scripts/nightlyScan.ts %*
echo.
pause
