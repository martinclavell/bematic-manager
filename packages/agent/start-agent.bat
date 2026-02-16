@echo off
REM Bematic Agent Wrapper Script
REM Automatically restarts the agent when it exits with code 75 (restart requested)
REM Usage: start-agent.bat

cd /d "%~dp0"

set RESTART_CODE=75

echo [agent-wrapper] Starting Bematic Agent...

:loop
echo [agent-wrapper] Building TypeScript...
call npx tsc
if %ERRORLEVEL% NEQ 0 (
    echo [agent-wrapper] Build failed. Retrying in 10s...
    timeout /t 10 /nobreak >nul
    goto loop
)

echo [agent-wrapper] Launching agent process...
node dist/index.js
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% EQU %RESTART_CODE% (
    echo [agent-wrapper] Agent requested restart. Restarting in 2s...
    timeout /t 2 /nobreak >nul
    goto loop
)

echo [agent-wrapper] Agent exited with code %EXIT_CODE%. Stopping.
exit /b %EXIT_CODE%
