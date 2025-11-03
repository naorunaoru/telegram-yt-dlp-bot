#!/bin/sh
# Docker entrypoint script for telegram-grabber-bot
# Handles cron setup, initial update, and bot startup

set -e

echo "Starting telegram-grabber-bot..."

# Check if auto-update is enabled (default: true)
YTDLP_AUTO_UPDATE=${YTDLP_AUTO_UPDATE:-true}

if [ "$YTDLP_AUTO_UPDATE" = "true" ]; then
    # Set default cron schedule (every 24 hours at minute 0)
    YTDLP_UPDATE_CRON=${YTDLP_UPDATE_CRON:-"0 */24 * * *"}

    echo "Setting up cron for yt-dlp updates with schedule: $YTDLP_UPDATE_CRON"

    # Create crontab entry
    # Redirect output to Docker logs (stdout/stderr)
    echo "$YTDLP_UPDATE_CRON /usr/src/app/scripts/update-ytdlp.sh >> /proc/1/fd/1 2>> /proc/1/fd/2" > /etc/crontabs/root

    # Start crond in the background
    crond -b -l 2

    echo "Cron daemon started"

    # Run initial update check on startup
    echo "Running initial yt-dlp update check..."
    /usr/src/app/scripts/update-ytdlp.sh || echo "Initial update check failed, continuing anyway..."
else
    echo "yt-dlp auto-update is disabled"
fi

# Start the bot
echo "Starting bot..."
exec npm start
