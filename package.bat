@echo off
setlocal

:: ─────────────────────────────────────────────────────────
:: TradeCore — Package repo for deployment to another machine
:: Creates a zip with everything needed to install & run.
:: Excludes: node_modules, .next, .env files (secrets)
:: ─────────────────────────────────────────────────────────

set "REPO_DIR=%~dp0"
set "TIMESTAMP=%DATE:~6,4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"
set "ZIP_NAME=TradeCore_%TIMESTAMP%.zip"
set "OUT_DIR=%REPO_DIR%..\"
set "ZIP_PATH=%OUT_DIR%%ZIP_NAME%"

echo.
echo  ═══════════════════════════════════════════
echo   TradeCore — Packaging for deployment
echo  ═══════════════════════════════════════════
echo.
echo  Source:  %REPO_DIR%
echo  Output:  %ZIP_PATH%
echo.

:: Build exclude list as a temp file for tar
set "EXCLUDEFILE=%TEMP%\tradecore_exclude.txt"
(
echo node_modules
echo .next
echo .env
echo .env.local
echo .env.production.local
echo tsconfig.tsbuildinfo
echo coverage
echo .DS_Store
) > "%EXCLUDEFILE%"

:: Use PowerShell Compress-Archive (available on all modern Windows)
powershell -NoProfile -Command ^
  "$src = '%REPO_DIR%'.TrimEnd('\');" ^
  "$excludeDirs = @('node_modules','.next','coverage');" ^
  "$excludeFiles = @('.env','.env.local','.env.production.local','tsconfig.tsbuildinfo','.DS_Store');" ^
  "$items = Get-ChildItem -Path $src -Force | Where-Object {" ^
  "  $name = $_.Name;" ^
  "  if ($_.PSIsContainer) { $excludeDirs -notcontains $name }" ^
  "  else { $excludeFiles -notcontains $name }" ^
  "};" ^
  "Write-Host ('  Including ' + $items.Count + ' items...');" ^
  "$items | ForEach-Object { Write-Host ('    + ' + $_.Name) };" ^
  "Compress-Archive -Path ($items | ForEach-Object { $_.FullName }) -DestinationPath '%ZIP_PATH%' -Force;" ^
  "Write-Host '';" ^
  "$size = (Get-Item '%ZIP_PATH%').Length / 1MB;" ^
  "Write-Host ('  Created: %ZIP_NAME% (' + [math]::Round($size,1) + ' MB)');"

if errorlevel 1 (
  echo.
  echo  ERROR: Packaging failed.
  pause
  exit /b 1
)

echo.
echo  ═══════════════════════════════════════════
echo   Package complete!
echo  ═══════════════════════════════════════════
echo.
echo  To install on a new machine:
echo.
echo    1. Unzip %ZIP_NAME%
echo    2. Copy .env.example to .env and fill in values:
echo       - DATABASE_URL       (PostgreSQL connection)
echo       - SCHEDULED_SCAN_TOKEN
echo       - DASHBOARD_TOKEN    (optional)
echo       - T212_API_KEY       (optional)
echo       - T212_API_SECRET    (optional)
echo       - TELEGRAM_BOT_TOKEN (optional)
echo       - TELEGRAM_CHAT_ID   (optional)
echo    3. npm install
echo    4. npx prisma generate
echo    5. npx prisma db push
echo    6. npm run dev
echo.

del "%EXCLUDEFILE%" 2>nul
pause
