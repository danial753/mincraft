@echo off
chcp 65001 >nul
title ParsBot
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js is not installed. Install it from https://nodejs.org  ^(LTS version^) and run this file again.
  echo.
  pause
  exit /b 1
)

rem --- first run: install dependencies ---
node scripts\ensure-deps.js
if exist "..\mineflayer\package.json" (
  if not exist "..\mineflayer\node_modules" (
    echo Installing mineflayer ^(first run only^)...
    pushd "..\mineflayer"
    call npm install --omit=dev --no-audit --no-fund
    popd
  )
)
if not exist "node_modules" (
  echo Installing ParsBot dependencies ^(first run only^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [!] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo Starting ParsBot... a browser page will open. Keep this window open while bots are running.
echo.
node src\index.js %*

echo.
echo ParsBot stopped.
pause
