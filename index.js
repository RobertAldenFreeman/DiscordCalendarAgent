// Main Discord Calendar Bot File
const { Client, GatewayIntentBits } = require('discord.js');
const winston = require('winston');
require('dotenv').config();

const CalendarService = require('./services/CalendarService');
const AvailabilityService = require('./services/AvailabilityService');
const CommandHandler = require('./handlers/CommandHandler');
const InteractionHandler = require('./handlers/InteractionHandler');
const MessageHandler = require('./handlers/MessageHandler');

// Logger configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
        })
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console()
    ]
});

class DiscordCalendarBot {
    constructor(config) {
        this.config = config;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions
            ]
        });
        
        // Initialize services
        this.calendarService = new CalendarService(this.client);
        this.availabilityService = new AvailabilityService();
        
        // Initialize handlers
        this.commandHandler = new CommandHandler(this.client, this.calendarService, this.availabilityService);
        this.interactionHandler = new InteractionHandler(this.client, this.calendarService, this.availabilityService);
        this.messageHandler = new MessageHandler(this.client, this.calendarService, this.availabilityService);
        
        this.setupEventHandlers();
        this.setupErrorHandling();
    }
    
    setupErrorHandling() {
        this.client.on('error', error => {
            logger.error('Discord client error:', { error: error.message, stack: error.stack });
        });
        
        process.on('unhandledRejection', error => {
            logger.error('Unhandled promise rejection:', { error: error.message, stack: error.stack });
        });
    }
    
    setupEventHandlers() {
        this.client.on('ready', async () => {
            logger.info(`Logged in as ${this.client.user.tag}`);
            await this.commandHandler.registerSlashCommands(this.config.token);
            this.client.user.setActivity('availability | /calendar', { type: 3 });
        });
        
        // Handle interactions (slash commands, buttons, selects)
        this.client.on('interactionCreate', async interaction => {
            await this.interactionHandler.handle(interaction);
        });
        
        // Handle text commands and availability messages
        this.client.on('messageCreate', async message => {
            await this.messageHandler.handle(message);
        });
        
        // Handle message updates
        this.client.on('messageUpdate', async (oldMessage, newMessage) => {
            await this.messageHandler.handleUpdate(oldMessage, newMessage);
        });
        
        // Handle message deletions
        this.client.on('messageDelete', async message => {
            await this.messageHandler.handleDelete(message);
        });
    }
    
    async start() {
        try {
            await this.client.login(this.config.token);
        } catch (error) {
            logger.error('Failed to start bot:', { error: error.message, stack: error.stack });
            process.exit(1);
        }
    }
}

// Load configuration
const config = {
    token: process.env.DISCORD_TOKEN || require('./config.json').token,
    clientId: process.env.CLIENT_ID || require('./config.json').clientId,
    guildId: process.env.GUILD_ID || require('./config.json').guildId
};

// Export logger for use in other modules
module.exports.logger = logger;

// Start bot with error handling
try {
    const bot = new DiscordCalendarBot(config);
    bot.start();
} catch (error) {
    logger.error('Failed to create bot:', { error: error.message, stack: error.stack });
    process.exit(1);
}

// Proper shutdown handling
process.on('SIGINT', () => {
    logger.info('Received SIGINT. Shutting down...');
    process.exit(0);
});