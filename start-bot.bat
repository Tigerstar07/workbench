@echo off
REM Double-click to run the radar + paper bot with auto-restart (keeps it alive
REM across crashes). It will re-arm itself on each start if PAPER_BOT_AUTOSTART
REM is set in .env.local. Leave this window open; close it to stop the bot.
cd /d "%~dp0"
set "NPM=npm"
where npm >nul 2>nul
if errorlevel 1 if exist "%~dp0..\work\tools\node-v24.17.0-win-x64\npm.cmd" (
  set "NODE_HOME=%~dp0..\work\tools\node-v24.17.0-win-x64"
  set "NPM=%~dp0..\work\tools\node-v24.17.0-win-x64\npm.cmd"
  set "PATH=%~dp0..\work\tools\node-v24.17.0-win-x64;%PATH%"
)
if /I "%~1"=="--check-tools" (
  "%NPM%" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)
echo Starting Momentum Radar + paper bot + analyzer with auto-restart...
echo Keep this window open. It also prevents PC sleep while running.
echo Analyzer watches paper-bot-trades.csv and waits until closed trades exist.
echo Press Ctrl+C (or close it) to stop.
echo.
"%NPM%" run dev:forever
pause
