@echo off
title ClipForge Launcher
echo =========================================
echo  ClipForge Launcher - Starting Servers...
echo =========================================
echo.

if not exist node_modules (
    echo [1/4] node_modules not found. Installing dependencies...
    call npm install
) else (
    echo [1/4] Dependencies found. Skipping install.
)

echo [2/4] Opening browser at http://localhost:5173...
start http://localhost:5173

echo [3/4] Spawning CLI execution terminal...
start cmd /k "echo ================================================== & echo  ClipForge CLI Execution Terminal & echo ================================================== & echo. & echo Paste your generated command here and press Enter to run it. & echo. & title ClipForge CLI Terminal"

echo [4/4] Starting Frontend and Backend servers...
echo Press Ctrl+C in this window to close both servers.
call npm start
