#!/bin/sh
# Docker entrypoint script for telegram-grabber-bot
# Handles cron setup, initial update, and bot startup

set -e

echo "Starting telegram-grabber-bot..."

prepare_cookie_file() {
    var_name="$1"
    cookie_file="$(eval "printf '%s' \"\${$var_name:-}\"")"

    if [ -z "$cookie_file" ]; then
        return
    fi

    if [ ! -r "$cookie_file" ]; then
        echo "Configured cookie file for $var_name is not readable: $cookie_file" >&2
        exit 1
    fi

    case "$cookie_file" in
        /tmp/*)
            return
            ;;
    esac

    prepared_file="/tmp/${var_name}.txt"
    cp "$cookie_file" "$prepared_file"
    chmod 600 "$prepared_file"
    export "$var_name=$prepared_file"
    echo "Prepared writable cookie file for $var_name at $prepared_file"
}

prepare_cookie_file DOWNLOADER_COOKIES_FILE
prepare_cookie_file INSTAGRAM_COOKIES_FILE
prepare_cookie_file REDDIT_COOKIES_FILE
prepare_cookie_file YTDLP_COOKIES_FILE
prepare_cookie_file GDL_COOKIES_FILE

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
