# Use Node.js LTS version for stability
FROM node:18-alpine

# Install dependencies for building native modules
RUN apk add --no-cache python3 make g++

# Create app directory and set ownership
WORKDIR /usr/src/app

# Install app dependencies first for better caching
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs handlers services utils

# Set proper permissions
RUN chown -R node:node /usr/src/app

# Run as non-root user
USER node

# Start the bot
CMD ["npm", "start"]