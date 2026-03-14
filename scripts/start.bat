@echo off
echo Starting VolumeTurtle...
cd /d "%~dp0.."
npm run build
npm run start
