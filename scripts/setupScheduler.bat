@echo off
echo Setting up VolumeTurtle scheduled scans...
echo.

REM --- Create log directory ---
mkdir "%USERPROFILE%\VolumeTurtle\logs" 2>nul

REM --- LSE Scan: 17:30 daily ---
schtasks /create /tn "VolumeTurtle_LSE_Scan" ^
  /tr "curl -s \"http://localhost:3000/api/scan/scheduled?market=LSE&token=%SCHEDULED_SCAN_TOKEN%\" > \"%USERPROFILE%\VolumeTurtle\logs\lse_scan.log\" 2>&1" ^
  /sc daily ^
  /st 17:30 ^
  /f

echo LSE scan scheduled at 17:30

REM --- US Scan: 22:00 daily ---
schtasks /create /tn "VolumeTurtle_US_Scan" ^
  /tr "curl -s \"http://localhost:3000/api/scan/scheduled?market=US&token=%SCHEDULED_SCAN_TOKEN%\" > \"%USERPROFILE%\VolumeTurtle\logs\us_scan.log\" 2>&1" ^
  /sc daily ^
  /st 22:00 ^
  /f

echo US scan scheduled at 22:00

REM --- Start app on Windows login ---
schtasks /create /tn "VolumeTurtle_Startup" ^
  /tr "\"%~dp0start.bat\"" ^
  /sc onlogon ^
  /f

echo App startup on login scheduled
echo.

echo Done. Tasks created:
schtasks /query /tn "VolumeTurtle_LSE_Scan"
schtasks /query /tn "VolumeTurtle_US_Scan"
schtasks /query /tn "VolumeTurtle_Startup"
echo.
echo Run this to remove schedules:
echo   schtasks /delete /tn "VolumeTurtle_LSE_Scan" /f
echo   schtasks /delete /tn "VolumeTurtle_US_Scan" /f
echo   schtasks /delete /tn "VolumeTurtle_Startup" /f
pause
