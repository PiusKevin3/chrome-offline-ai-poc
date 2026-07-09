@echo off
title Chrome Offline AI Local Inference Server
cls
echo ==========================================================
echo               CHROME OFFLINE AI SERVICE
echo            Headless Inference Endpoint (OpenAI API)
echo ==========================================================
echo.

:: Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js v18 or higher and try again.
    pause
    exit /b 1
)

:: Run npm install if node_modules doesn't exist
if not exist "node_modules" (
    echo [INFO] node_modules folder not found. Running npm install...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
      )
)

:: Launch the playground dashboard in default browser after a short delay
echo [INFO] Launching playground in your default browser...
start "" "http://localhost:3010"

:: Start the Express server
echo [INFO] Starting API server...
node server.js

pause
