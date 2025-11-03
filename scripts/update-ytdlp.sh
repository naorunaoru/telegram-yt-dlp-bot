#!/bin/sh
# Script to update yt-dlp via pip
# Can be called by cron or manually

set -e

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting yt-dlp update check..."

# Get current version
CURRENT_VERSION=$(yt-dlp --version 2>/dev/null || echo "unknown")
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Current version: $CURRENT_VERSION"

# Fetch latest version from PyPI
LATEST_VERSION=$(wget -qO- https://pypi.org/pypi/yt-dlp/json | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Latest version: $LATEST_VERSION"

# Compare versions
if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] yt-dlp is already up to date"
    exit 0
fi

# Update yt-dlp
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Updating yt-dlp..."
pip install --break-system-packages -U "yt-dlp[default]"

# Verify update
NEW_VERSION=$(yt-dlp --version 2>/dev/null || echo "unknown")
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Successfully updated to version $NEW_VERSION"
