@echo off
setlocal
title Opera Agent installer

rem Double-click entry point. PowerShell handles the policy work; this wrapper
rem only makes sure the window stays open so the result is readable.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-opera-agent.ps1" %*
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
  echo Installer finished.
) else (
  echo Installer stopped with exit code %EXITCODE%.
)
echo Press any key to close this window.
pause >nul
endlocal