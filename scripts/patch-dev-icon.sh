#!/bin/bash

ELECTRON_APP="node_modules/electron/dist/Electron.app"
RESOURCES="$ELECTRON_APP/Contents/Resources"
ICON_SRC="resources/icon.icns"

# Only run on macOS
if [ "$(uname)" != "Darwin" ]; then
  exit 0
fi

# Only run if source icon exists
if [ ! -f "$ICON_SRC" ]; then
  exit 0
fi

# Replace the icon
cp "$ICON_SRC" "$RESOURCES/electron.icns"

# Touch the bundle to invalidate macOS icon cache
touch "$ELECTRON_APP"

# Re-sign with ad-hoc signature (required after modifying bundle contents)
codesign --force --deep --sign - "$ELECTRON_APP" 2>/dev/null || true
