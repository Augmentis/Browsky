#!/bin/bash
# Browsky dev mode
# Launches Chrome with remote debugging and starts the error feedback loop

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DEBUG_PORT=9222
PROFILE_DIR="$SCRIPT_DIR/.chrome-dev-profile"

# ── Check Chrome isn't already running with debug port ────────────────────────
if lsof -i :$DEBUG_PORT -sTCP:LISTEN &>/dev/null; then
  echo "Port $DEBUG_PORT already in use — attaching to existing Chrome instance."
else
  echo "Launching Chrome with remote debugging on port $DEBUG_PORT..."
  mkdir -p "$PROFILE_DIR"
  "$CHROME" \
    --remote-debugging-port=$DEBUG_PORT \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    &
  # Wait for Chrome to be ready
  echo "Waiting for Chrome..."
  for i in $(seq 1 20); do
    if curl -s "http://localhost:$DEBUG_PORT/json" > /dev/null 2>&1; then
      echo "Chrome ready."
      break
    fi
    sleep 0.5
  done
fi

echo ""
echo "---------------------------------------------------------------"
echo "  Load the extension if not already loaded:"
echo "  chrome://extensions → Load unpacked → $PROJECT_DIR/extension"
echo "---------------------------------------------------------------"
echo ""

# ── Start error loop ──────────────────────────────────────────────────────────
node "$SCRIPT_DIR/error-loop.js"
