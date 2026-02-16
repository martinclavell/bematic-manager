#!/bin/bash
# Bematic Agent Wrapper Script
# Automatically restarts the agent when it exits with code 75 (restart requested)
# Usage: bash start-agent.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RESTART_CODE=75

echo "[agent-wrapper] Starting Bematic Agent..."

while true; do
  # Build TypeScript
  echo "[agent-wrapper] Building TypeScript..."
  npx tsc
  BUILD_EXIT=$?

  if [ $BUILD_EXIT -ne 0 ]; then
    echo "[agent-wrapper] Build failed (exit code $BUILD_EXIT). Retrying in 10s..."
    sleep 10
    continue
  fi

  # Run the agent
  echo "[agent-wrapper] Launching agent process..."
  node dist/index.js
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq $RESTART_CODE ]; then
    echo "[agent-wrapper] Agent requested restart (exit code $RESTART_CODE). Restarting in 2s..."
    sleep 2
  else
    echo "[agent-wrapper] Agent exited with code $EXIT_CODE. Stopping."
    exit $EXIT_CODE
  fi
done
