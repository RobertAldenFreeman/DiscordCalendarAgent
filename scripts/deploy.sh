#!/bin/bash

# Deploy script for Discord bot to Digital Ocean Ubuntu 24.10 server

# Configuration
REMOTE_USER="root"
REMOTE_HOST="your_droplet_ip"
REMOTE_DIR="/opt/discord-bot"
LOCAL_DIR="."
EXCLUDE_PATTERNS="--exclude='node_modules' --exclude='.git' --exclude='logs' --exclude='.env' --exclude='*.log'"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting deployment to $REMOTE_HOST...${NC}"

# Create remote directory if it doesn't exist
ssh $REMOTE_USER@$REMOTE_HOST "mkdir -p $REMOTE_DIR"

# Sync files to remote server
echo -e "${YELLOW}Syncing files...${NC}"
eval rsync -avz --delete $EXCLUDE_PATTERNS $LOCAL_DIR/ $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/

# Deploy on remote server
echo -e "${YELLOW}Deploying application...${NC}"
ssh $REMOTE_USER@$REMOTE_HOST << 'ENDSSH'
cd /opt/discord-bot

# Set proper permissions
chown -R node:node .

# Build and restart containers
docker compose down
docker compose build --no-cache
docker compose up -d

# Check status
docker compose ps
docker compose logs --tail=50
ENDSSH

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}You can check logs with: ssh $REMOTE_USER@$REMOTE_HOST 'cd $REMOTE_DIR && docker compose logs -f'${NC}"