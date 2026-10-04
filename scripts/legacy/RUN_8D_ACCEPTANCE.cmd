REM @last-edited: 2026-10-04 18:25 UTC+7.
REM @title: RUN_8D_ACCEPTANCE — Repository file.
REM @context: Script.
REM @state: chore(naming): tidy repository names and enforce binding naming rules.
REM @updated: every file carries Last edited, Title, Purpose and Now
REM @dependencies: none stated.

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
