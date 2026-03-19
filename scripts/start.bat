@echo off
echo Starting VolumeTurtle...
cd /d "%~dp0.."

npm run build
if errorlevel 1 (
  echo ERROR: Build failed. Aborting start.
  pause
  exit /b 1
)

npm run start
if errorlevel 1 (
  echo ERROR: Start failed.
  pause
  exit /b 1
)
