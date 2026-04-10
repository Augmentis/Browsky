#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$SCRIPT_DIR/native-host/launcher.js"
MANIFEST_TEMPLATE="$SCRIPT_DIR/native-host/com.augmentis.browsky.json"
CHROME_HOSTS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_DEST="$CHROME_HOSTS/com.augmentis.browsky.json"

EXTENSION_ID="${1:-EXTENSION_ID}"

echo ""
echo "==> Browsky Installer"
echo ""

# Server dependencies
echo "Installing server dependencies..."
(cd "$SCRIPT_DIR/server" && npm install --silent)
echo "Done."

# Make launcher executable
chmod +x "$LAUNCHER"

# Write the resolved native messaging host manifest
mkdir -p "$CHROME_HOSTS"
sed \
  -e "s|LAUNCHER_PATH|$LAUNCHER|g" \
  -e "s|EXTENSION_ID|$EXTENSION_ID|g" \
  "$MANIFEST_TEMPLATE" > "$MANIFEST_DEST"

echo "Native host manifest written to:"
echo "  $MANIFEST_DEST"
echo ""

if [ "$EXTENSION_ID" = "EXTENSION_ID" ]; then
  echo "---------------------------------------------------------------"
  echo "  ACTION REQUIRED: Extension ID not set yet."
  echo ""
  echo "  1. Open chrome://extensions in Chrome"
  echo "  2. Enable Developer Mode (top-right toggle)"
  echo "  3. Click 'Load unpacked' and select:"
  echo "     $SCRIPT_DIR/extension"
  echo "  4. Copy the Extension ID shown under the extension name"
  echo "  5. Re-run this script with your ID:"
  echo "     ./install.sh <YOUR_EXTENSION_ID>"
  echo "---------------------------------------------------------------"
else
  echo "Extension ID set to: $EXTENSION_ID"
  echo ""
  echo "---------------------------------------------------------------"
  echo "  Setup complete."
  echo ""
  echo "  If the extension is not already loaded:"
  echo "  1. Open chrome://extensions"
  echo "  2. Enable Developer Mode"
  echo "  3. Click 'Load unpacked' → select: $SCRIPT_DIR/extension"
  echo ""
  echo "  Then click the Browsky icon in the Chrome toolbar."
  echo "---------------------------------------------------------------"
fi
echo ""
