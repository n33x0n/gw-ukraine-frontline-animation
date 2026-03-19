#!/bin/bash
# Cron wrapper for frontline data updates
# Usage: add to crontab:
#   15 8 * * *  /var/www/gw-ukraine-frontline/update_frontline.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK_FILE="/tmp/ukraine-frontline-update.lock"
LOG_FILE="/var/log/ukraine-frontline-update.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Prevent parallel runs
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    log "SKIP: another instance is already running"
    exit 0
fi

log "START: updating frontline data"

cd "$SCRIPT_DIR" || { log "ERROR: cannot cd to $SCRIPT_DIR"; exit 1; }

if python3 download_data.py >> "$LOG_FILE" 2>&1; then
    date '+%Y-%m-%d %H:%M:%S' > "$SCRIPT_DIR/.last_successful_update"
    log "OK: update completed successfully"
else
    log "ERROR: download_data.py exited with code $?"
    exit 1
fi
