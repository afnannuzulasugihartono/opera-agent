@echo off

REM @last-edited: 2026-10-21 UTC+7.
REM @title: opera-chrome — the dedicated Chrome this product drives, with the extension always loaded.
REM @state: the profile, the debugging port and the extension path, and nothing else.
REM @dependencies: none.
REM Opera Agent dedicated Chrome: persistent profile, debugging port, extension always loaded.
REM Run this instead of opening Chrome normally.
REM Sign in to Google once; the profile keeps the login and the flag keeps the extension across restarts.

setlocal
set PROFILE=%LOCALAPPDATA%\OperaAgent\ChromeProfile
set EXTDIR=%~dp0..\..\extension
if not exist "%PROFILE%" mkdir "%PROFILE%" 2>nul
start "Opera Agent Chrome" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%PROFILE%" --remote-debugging-port=9450 --load-extension="%EXTDIR%" --no-first-run --no-default-browser-check about:blank
