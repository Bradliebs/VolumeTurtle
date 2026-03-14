@echo off
cd /d "%~dp0"
start "" http://localhost:3000
call npx next dev
