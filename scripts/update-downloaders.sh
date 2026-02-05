#!/bin/sh
# Script to update yt-dlp and gallery-dl via pip
# Can be called by cron or manually

set -e

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting downloader update check..."

# Function to check and update a package
update_package() {
    PACKAGE=$1
    COMMAND=$2
    
    echo ""
    echo "=== $PACKAGE ==="
    
    # Get current version
    CURRENT_VERSION=$($COMMAND --version 2>/dev/null || echo "not installed")
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Current version: $CURRENT_VERSION"
    
    # Fetch latest version from PyPI
    LATEST_VERSION=$(wget -qO- "https://pypi.org/pypi/$PACKAGE/json" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Latest version: $LATEST_VERSION"
    
    # Compare versions
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $PACKAGE is already up to date"
        return 0
    fi
    
    # Update package
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Updating $PACKAGE..."
    if [ "$PACKAGE" = "yt-dlp" ]; then
        pip install --break-system-packages -U "yt-dlp[default]"
    else
        pip install --break-system-packages -U "$PACKAGE"
    fi
    
    # Verify update
    NEW_VERSION=$($COMMAND --version 2>/dev/null || echo "unknown")
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Successfully updated $PACKAGE to version $NEW_VERSION"
}

# Update both downloaders
update_package "yt-dlp" "yt-dlp"
update_package "gallery-dl" "gallery-dl"

echo ""
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Update check complete"
