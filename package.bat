@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ─────────────────────────────────────────────────────────
:: VolumeTurtle — Package for deployment to another machine
:: Creates a zip containing everything needed + auto-installer
::
:: Give someone the zip and tell them:
::   1. Unzip it anywhere
::   2. Double-click INSTALL.bat
::   3. Follow the on-screen steps
:: ─────────────────────────────────────────────────────────

title VolumeTurtle — Packager

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║     VolumeTurtle — Create Deploy Zip      ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Use PowerShell for reliable timestamp (locale-independent)
for /f "tokens=*" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmm'"') do set "TIMESTAMP=%%t"

set "REPO_DIR=%~dp0"
set "ZIP_NAME=VolumeTurtle_%TIMESTAMP%.zip"
set "OUT_DIR=%USERPROFILE%\Desktop\"
set "ZIP_PATH=%OUT_DIR%%ZIP_NAME%"

:: Check Desktop exists, fallback to repo parent
if not exist "%OUT_DIR%" set "OUT_DIR=%REPO_DIR%..\"
set "ZIP_PATH=%OUT_DIR%%ZIP_NAME%"

echo  [1/2] Packaging files...
echo         (excluding node_modules, .next, .git, .env)
echo.

powershell -NoProfile -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "try {" ^
  "  $src = '%REPO_DIR%'.TrimEnd('\');" ^
  "  $excludeDirs = @('node_modules','.next','coverage','.git');" ^
  "  $excludeFiles = @('.env','.env.local','.env.production.local','tsconfig.tsbuildinfo','.DS_Store');" ^
  "  $items = Get-ChildItem -Path $src -Force | Where-Object {" ^
  "    $name = $_.Name;" ^
  "    if ($_.PSIsContainer) { $excludeDirs -notcontains $name }" ^
  "    else { $excludeFiles -notcontains $name }" ^
  "  };" ^
  "  Write-Host ('         Including ' + $items.Count + ' items');" ^
  "  Compress-Archive -Path ($items | ForEach-Object { $_.FullName }) -DestinationPath '%ZIP_PATH%' -Force;" ^
  "  $size = (Get-Item '%ZIP_PATH%').Length / 1MB;" ^
  "  Write-Host ('         Zip size: ' + [math]::Round($size,1) + ' MB');" ^
  "} catch {" ^
  "  Write-Host ('  ERROR: ' + $_.Exception.Message);" ^
  "  exit 1;" ^
  "}"
if errorlevel 1 (
  echo.
  echo  ERROR: Packaging failed.
  echo  Make sure you have enough disk space and try again.
  pause
  exit /b 1
)

echo.
echo  [2/2] Done!
echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║                                           ║
echo  ║   Zip saved to your Desktop:              ║
echo  ║   %ZIP_NAME%          ║
echo  ║                                           ║
echo  ║   To deploy on another machine:           ║
echo  ║   1. Copy the zip to the other PC         ║
echo  ║   2. Right-click, Extract All             ║
echo  ║   3. Double-click INSTALL.bat             ║
echo  ║   4. Follow the on-screen steps           ║
echo  ║                                           ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Open the folder containing the zip
start "" "%OUT_DIR%"

pause
