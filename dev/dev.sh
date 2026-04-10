#!/bin/bash
# Plugin dev mode — reads cdpPort from ../dev.config.json

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_DIR="$SCRIPT_DIR/.chrome-dev-profile"

# Read cdpPort from dev.config.json (default 9222)
if command -v node &>/dev/null && [ -f "$PROJECT_DIR/dev.config.json" ]; then
  DEBUG_PORT=$(node -e "const c=require('$PROJECT_DIR/dev.config.json'); console.log(c.cdpPort||9222)")
else
  DEBUG_PORT=9222
fi

if lsof -i :$DEBUG_PORT -sTCP:LISTEN &>/dev/null; then
  echo "Port $DEBUG_PORT already open — attaching to existing Chrome instance."
else
  echo "Launching Chrome with remote debugging on port $DEBUG_PORT..."
  mkdir -p "$PROFILE_DIR"
  "$CHROME" \
    --remote-debugging-port=$DEBUG_PORT \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    &
  echo "Waiting for Chrome..."
  for i in $(seq 1 20); do
    if curl -s "http://localhost:$DEBUG_PORT/json" > /dev/null 2>&1; then
      echo "Chrome ready."; break
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

node "$SCRIPT_DIR/error-loop.js"
