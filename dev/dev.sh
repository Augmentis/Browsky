#!/bin/bash
# Plugin dev mode — reads cdpPort from ../dev.config.json

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_DIR="$SCRIPT_DIR/.chrome-dev-profile"

# ── Detect Chrome binary ──────────────────────────────────────────────────────
detect_chrome() {
  case "$(uname -s)" in
    Darwin)
      for p in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
        [ -x "$p" ] && echo "$p" && return
      done
      ;;
    Linux)
      for p in \
        google-chrome google-chrome-stable chromium chromium-browser; do
        command -v "$p" &>/dev/null && echo "$p" && return
      done
      ;;
    MINGW*|MSYS*|CYGWIN*)
      for p in \
        "/c/Program Files/Google/Chrome/Application/chrome.exe" \
        "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
        [ -x "$p" ] && echo "$p" && return
      done
      ;;
  esac
  echo ""
}

# ── Detect open-port command (lsof on mac, ss/netstat on linux) ───────────────
port_in_use() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -i :"$port" -sTCP:LISTEN &>/dev/null
  elif command -v ss &>/dev/null; then
    ss -ltn | grep -q ":$port "
  else
    netstat -ltn 2>/dev/null | grep -q ":$port "
  fi
}

# ── Read cdpPort from dev.config.json (default 9222) ─────────────────────────
if command -v node &>/dev/null && [ -f "$PROJECT_DIR/dev.config.json" ]; then
  DEBUG_PORT=$(node -e "const c=require('$PROJECT_DIR/dev.config.json'); console.log(c.cdpPort||9222)")
else
  DEBUG_PORT=9222
fi

# ── Launch Chrome if not already running on debug port ───────────────────────
if port_in_use "$DEBUG_PORT"; then
  echo "Port $DEBUG_PORT already open — attaching to existing Chrome instance."
else
  CHROME=$(detect_chrome)
  if [ -z "$CHROME" ]; then
    echo "Error: Could not find Chrome or Chromium."
    echo "  macOS:  install Google Chrome from https://www.google.com/chrome"
    echo "  Linux:  sudo apt install chromium-browser  OR  sudo apt install google-chrome-stable"
    exit 1
  fi

  echo "Launching Chrome: $CHROME"
  echo "Remote debugging on port $DEBUG_PORT..."
  mkdir -p "$PROFILE_DIR"
  "$CHROME" \
    --remote-debugging-port="$DEBUG_PORT" \
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
