@echo off
title JPM Suspense Amount Dashboard
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing required packages - first run only...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Package installation failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

echo Starting JPM Suspense Amount Dashboard...
echo Keep this window open while the dashboard is in use. Close it to stop the server.
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
node server.js
pause
