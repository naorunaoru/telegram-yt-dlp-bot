#!/bin/sh
# Docker entrypoint script for telegram-grabber-bot
# Handles cron setup, initial update, and bot startup

set -e

echo "Starting telegram-grabber-bot..."

# Check if auto-update is enabled (default: true)
DOWNLOADERS_AUTO_UPDATE=${DOWNLOADERS_AUTO_UPDATE:-${YTDLP_AUTO_UPDATE:-true}}

if [ "$DOWNLOADERS_AUTO_UPDATE" = "true" ]; then
    # Set default cron schedule (every 24 hours at minute 0)
    DOWNLOADERS_UPDATE_CRON=${DOWNLOADERS_UPDATE_CRON:-${YTDLP_UPDATE_CRON:-"0 */24 * * *"}}

    echo "Setting up cron for downloader updates with schedule: $DOWNLOADERS_UPDATE_CRON"

    # Create crontab entry
    # Redirect output to Docker logs (stdout/stderr)
    echo "$DOWNLOADERS_UPDATE_CRON /usr/src/app/scripts/update-downloaders.sh >> /proc/1/fd/1 2>> /proc/1/fd/2" > /etc/crontabs/root

    # Start crond in the background
    crond -b -l 2

    echo "Cron daemon started"

    # Run initial update check on startup
    echo "Running initial downloader update check..."
    /usr/src/app/scripts/update-downloaders.sh || echo "Initial update check failed, continuing anyway..."
else
    echo "Downloader auto-update is disabled"
fi

# Start the bot
echo "Starting bot..."
exec npm start
