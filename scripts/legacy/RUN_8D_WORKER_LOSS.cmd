REM Last edited: 2026-10-04 17:52. Title: RUN_8D_WORKER_LOSS — Repository file. Now: chore(naming): tidy repository names and enforce binding naming rules.

@echo off
setlocal
where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell 7 ^(pwsh^) is required. Install PowerShell 7, then run this file again.
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-8d-worker-loss.ps1" %*
exit /b %ERRORLEVEL%
