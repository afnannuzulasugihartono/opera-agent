REM @last-edited: 2026-10-04 18:25 UTC+7.
REM @title: run-transaction-edge-concurrency — legacy edge concurrency launcher.
REM @state: chore(naming): tidy repository names and enforce binding naming rules.
REM @dependencies: none stated.

@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 ^(pwsh.exe^) is required.
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-transaction-edge-concurrency.ps1" %*
exit /b %ERRORLEVEL%
