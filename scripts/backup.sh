#!/bin/bash

# Automated backup script for Discord bot

# Configuration
BACKUP_DIR="/opt/backups/discord-bot"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BOT_DIR="/opt/discord-bot"
RETENTION_DAYS=7

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

# Create backup
echo "Creating backup..."
tar -czf "$BACKUP_DIR/discord_bot_backup_$TIMESTAMP.tar.gz" \
    -C "$BOT_DIR" \
    logs .env config.json

# Also backup the Docker volumes (if needed)
docker run --rm \
    -v discord-bot_logs:/data \
    -v "$BACKUP_DIR":/backup \
    alpine tar czf "/backup/docker_volumes_$TIMESTAMP.tar.gz" /data

# Clean up old backups
echo "Cleaning up old backups..."
find "$BACKUP_DIR" -name "*.tar.gz" -type f -mtime +$RETENTION_DAYS -delete

# List current backups
echo "Current backups:"
ls -lh "$BACKUP_DIR"

echo "Backup completed successfully!"