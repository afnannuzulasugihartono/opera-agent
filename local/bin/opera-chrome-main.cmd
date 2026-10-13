@echo off
REM Opera Agent on your everyday Chrome: debugging port plus extension on the
REM Default profile, so your login, tabs and extensions stay as they are.
REM Close EVERY Chrome window first: a running instance absorbs a new launch
REM and the flags die silently. Your tabs come back through History - Recently
REM closed, or set "Continue where you left off" once and forget it.
setlocal
set EXTDIR=%~dp0..\..\extension
start "Opera Agent Chrome" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9450 --load-extension="%EXTDIR%" about:blank
