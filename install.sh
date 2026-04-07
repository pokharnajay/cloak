#!/bin/bash
# Cloak Installer — bypasses macOS Gatekeeper for unsigned builds
# Usage: curl -sL https://raw.githubusercontent.com/pokharnajay/cloak/main/install.sh | bash

set -e

APP_NAME="Cloak"
REPO="pokharnajay/cloak"
INSTALL_DIR="/Applications"
TMP_DIR=$(mktemp -d)

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo ""
echo "  ╭──────────────────────────────╮"
echo "  │     Installing Cloak...      │"
echo "  ╰──────────────────────────────╯"
echo ""

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  ASSET_PATTERN="Cloak.*arm64.*\\.dmg"
elif [ "$ARCH" = "x86_64" ]; then
  ASSET_PATTERN="Cloak.*\\.dmg"
else
  echo "  Unsupported architecture: $ARCH"
  exit 1
fi

# Get latest release DMG URL
echo "  Fetching latest release..."
DMG_URL=$(curl -sL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep "browser_download_url" \
  | grep -i "\.dmg" \
  | head -1 \
  | sed -E 's/.*"(https[^"]+)".*/\1/')

if [ -z "$DMG_URL" ]; then
  echo "  Could not find DMG in latest release."
  echo "  Visit: https://github.com/$REPO/releases/latest"
  exit 1
fi

echo "  Downloading $(basename "$DMG_URL")..."
curl -sL "$DMG_URL" -o "$TMP_DIR/Cloak.dmg"

# Mount DMG silently
echo "  Mounting DMG..."
MOUNT_POINT=$(hdiutil attach "$TMP_DIR/Cloak.dmg" -nobrowse -quiet -mountpoint "$TMP_DIR/mnt" 2>/dev/null && echo "$TMP_DIR/mnt")
if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
  MOUNT_POINT="$TMP_DIR/mnt"
  hdiutil attach "$TMP_DIR/Cloak.dmg" -nobrowse -quiet -mountpoint "$MOUNT_POINT"
fi

# Remove old version if present
if [ -d "$INSTALL_DIR/$APP_NAME.app" ]; then
  echo "  Removing previous version..."
  rm -rf "$INSTALL_DIR/$APP_NAME.app"
fi

# Copy app
echo "  Copying to Applications..."
cp -R "$MOUNT_POINT/$APP_NAME.app" "$INSTALL_DIR/"

# Unmount
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

# Remove quarantine attribute (this is what bypasses Gatekeeper)
echo "  Removing quarantine flags..."
xattr -cr "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true

# Ad-hoc sign so macOS treats it as a known binary
echo "  Signing app..."
codesign --force --deep --sign - "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true

echo ""
echo "  Cloak installed successfully!"
echo ""
echo "  Launch from Applications or run:"
echo "    open /Applications/Cloak.app"
echo ""
echo "  On first launch, grant Accessibility permission"
echo "  when prompted (System Settings > Privacy & Security)."
echo ""

# Offer to launch
read -p "  Launch Cloak now? [Y/n] " -n 1 -r REPLY
echo ""
if [[ -z "$REPLY" || "$REPLY" =~ ^[Yy]$ ]]; then
  open "$INSTALL_DIR/$APP_NAME.app"
fi
