@echo off
cd /d "%~dp0"

:: Kill any leftover node processes holding ports
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Clean caches to prevent stale HMR state
echo Cleaning caches...
if exist .next rmdir /s /q .next
if exist node_modules\.cache rmdir /s /q node_modules\.cache

:: Start dev server in background
echo Starting dev server...
start /b cmd /c "npx next dev 2>&1"

:: Wait for server to be ready before opening browser
:wait
timeout /t 1 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:3000 2>nul | findstr "200" >nul
if errorlevel 1 goto wait

:: Server is up — open browser
echo Server ready, opening browser...
start "" http://localhost:3000

:: Attach to the server process so Ctrl+C kills it
echo Press Ctrl+C to stop the server.
:loop
timeout /t 3600 /nobreak >nul
goto loop
