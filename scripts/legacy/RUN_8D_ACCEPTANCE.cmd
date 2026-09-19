@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-8d-acceptance.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if "%EXITCODE%"=="0" (
  echo Milestone 8D acceptance launcher completed successfully.
) else (
  echo Milestone 8D acceptance launcher stopped with exit code %EXITCODE%.
)
echo.
pause
exit /b %EXITCODE%
