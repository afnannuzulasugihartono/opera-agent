REM @last-edited: 2026-10-04 11:10 UTC.
REM @title: RUN_8D_WORKER_LOSS — Repository file.
REM @context: Script.
REM @state: chore(naming): tidy repository names and enforce binding naming rules.
REM @updated: every file carries Last edited, Title, Purpose and Now
REM @dependencies: none stated.

@echo off
setlocal
where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell 7 ^(pwsh^) is required. Install PowerShell 7, then run this file again.
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-8d-worker-loss.ps1" %*
exit /b %ERRORLEVEL%
