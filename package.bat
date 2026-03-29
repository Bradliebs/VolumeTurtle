@echo off
setlocal

:: ─────────────────────────────────────────────────────────
:: TradeCore — Package repo for deployment to another machine
:: Creates a zip containing everything + an auto-installer
:: ─────────────────────────────────────────────────────────

set "REPO_DIR=%~dp0"
set "TIMESTAMP=%DATE:~6,4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"
set "ZIP_NAME=TradeCore_%TIMESTAMP%.zip"
set "OUT_DIR=%REPO_DIR%..\"
set "ZIP_PATH=%OUT_DIR%%ZIP_NAME%"

echo.
echo  TradeCore - Packaging for deployment
echo  ─────────────────────────────────────
echo.

powershell -NoProfile -Command ^
  "$src = '%REPO_DIR%'.TrimEnd('\');" ^
  "$excludeDirs = @('node_modules','.next','coverage','.git');" ^
  "$excludeFiles = @('.env','.env.local','.env.production.local','tsconfig.tsbuildinfo','.DS_Store');" ^
  "$items = Get-ChildItem -Path $src -Force | Where-Object {" ^
  "  $name = $_.Name;" ^
  "  if ($_.PSIsContainer) { $excludeDirs -notcontains $name }" ^
  "  else { $excludeFiles -notcontains $name }" ^
  "};" ^
  "Write-Host ('  Including ' + $items.Count + ' items');" ^
  "Compress-Archive -Path ($items | ForEach-Object { $_.FullName }) -DestinationPath '%ZIP_PATH%' -Force;" ^
  "$size = (Get-Item '%ZIP_PATH%').Length / 1MB;" ^
  "Write-Host ('  Created: %ZIP_NAME% (' + [math]::Round($size,1) + ' MB)');"

echo.
echo  Done! Zip saved to: %ZIP_PATH%
echo.
echo  Give someone the zip + tell them:
echo    1. Unzip it
echo    2. Double-click INSTALL.bat
echo    3. Follow the prompts
echo.
pause
