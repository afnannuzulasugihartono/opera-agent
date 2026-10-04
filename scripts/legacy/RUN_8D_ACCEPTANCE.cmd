REM Last edited: 2026-10-04 17:52. Title: RUN_8D_ACCEPTANCE — Repository file. Now: chore(naming): tidy repository names and enforce binding naming rules.

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
