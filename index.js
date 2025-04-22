// Enhanced Discord Calendar Bot with availability tracking
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { DateTime } = require('luxon');
const chrono = require('chrono-node');
const winston = require('winston');
require('dotenv').config();

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
        
        this.events = new Map(); // key: messageId, value: event data
        this.availabilities = new Map(); // key: date-time, value: Set of userIds
        this.unavailabilities = new Map(); // key: date-time, value: Set of userIds
        this.calendarMessages = new Map();
        
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
            await this.registerSlashCommands();
            this.setupActivityMonitoring();
        });
        
        // Handle slash commands
        this.client.on('interactionCreate', async interaction => {
            if (!interaction.isChatInputCommand()) return;
            
            if (interaction.commandName === 'calendar') {
                logger.info('Calendar slash command received', { 
                    guildId: interaction.guildId, 
                    channelId: interaction.channelId, 
                    userId: interaction.user.id 
                });
                
                // Reply immediately to prevent "thinking" state
                await interaction.reply({ content: 'Generating calendar...', ephemeral: true });
                
                try {
                    await this.processCalendarCommand(interaction);
                    await interaction.deleteReply();
                } catch (error) {
                    logger.error('Error processing calendar command:', { 
                        error: error.message, 
                        stack: error.stack
                    });
                    
                    await interaction.editReply({ 
                        content: `An error occurred: ${error.message}`,
                        ephemeral: true
                    });
                }
            }
        });
        
        // Handle text commands
        this.client.on('messageCreate', async message => {
            if (message.author.bot) return;
            
            if (message.content.startsWith('!calendar')) {
                try {
                    await this.processCalendarCommand(message);
                } catch (error) {
                    logger.error('Error handling message:', { 
                        error: error.message, 
                        stack: error.stack
                    });
                    
                    await message.reply(`An error occurred: ${error.message}`);
                }
            } else {
                // Check for availability statements
                this.extractAvailability(message);
            }
        });
        
        // Handle message updates
        this.client.on('messageUpdate', async (oldMessage, newMessage) => {
            if (newMessage.author.bot) return;
            
            try {
                // Remove old availability data
                this.removeAvailability(oldMessage);
                
                // Extract new availability
                this.extractAvailability(newMessage);
                
                // Update calendar if displayed
                await this.updateCalendarDisplay(newMessage.channel);
            } catch (error) {
                logger.error('Error handling message update:', { 
                    error: error.message, 
                    stack: error.stack
                });
            }
        });
        
        // Handle message deletions
        this.client.on('messageDelete', async message => {
            if (message.author.bot) return;
            
            try {
                this.removeAvailability(message);
                await this.updateCalendarDisplay(message.channel);
            } catch (error) {
                logger.error('Error handling message delete:', { 
                    error: error.message, 
                    stack: error.stack
                });
            }
        });
    }
    
    async registerSlashCommands() {
        const commands = [
            {
                name: 'calendar',
                description: 'Display a visual calendar of availability for the last week'
            }
        ];
        
        const rest = new REST({ version: '10' }).setToken(this.config.token);
        
        try {
            logger.info('Registering slash commands...');
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: commands }
            );
            logger.info('Successfully registered slash commands');
        } catch (error) {
            logger.error('Error registering slash commands:', { 
                error: error.message, 
                stack: error.stack 
            });
        }
    }
    
    setupActivityMonitoring() {
        this.client.user.setActivity('availability | /calendar', { type: 3 });
    }
    
    extractAvailability(message) {
        const content = message.content.toLowerCase();
        
        // Look for availability patterns
        const availablePatterns = [
            /(?:i'?m\s+)?(?:available|free)\s+(?:on\s+)?(.+)/i,
            /(?:i\s+)?can\s+(?:do|make|play)\s+(?:it\s+)?(?:on\s+)?(.+)/i
        ];
        
        const unavailablePatterns = [
            /(?:i'?m\s+)?(?:not\s+available|busy|unavailable)\s+(?:on\s+)?(.+)/i,
            /(?:i\s+)?can'?t\s+(?:do|make|play)\s+(?:it\s+)?(?:on\s+)?(.+)/i
        ];
        
        // Check for available times
        for (const pattern of availablePatterns) {
            const match = content.match(pattern);
            if (match) {
                const dateTimeText = match[1];
                const parsedDates = chrono.parse(dateTimeText);
                
                parsedDates.forEach(parsed => {
                    const date = parsed.start.date();
                    const dateKey = DateTime.fromJSDate(date).toFormat('yyyy-MM-dd HH:mm');
                    
                    if (!this.availabilities.has(dateKey)) {
                        this.availabilities.set(dateKey, new Set());
                    }
                    this.availabilities.get(dateKey).add(message.author.id);
                    
                    // Store event data
                    this.events.set(message.id, {
                        messageId: message.id,
                        author: message.author.username,
                        userId: message.author.id,
                        date: date,
                        text: message.content,
                        type: 'available',
                        channelId: message.channel.id
                    });
                });
                return;
            }
        }
        
        // Check for unavailable times
        for (const pattern of unavailablePatterns) {
            const match = content.match(pattern);
            if (match) {
                const dateTimeText = match[1];
                const parsedDates = chrono.parse(dateTimeText);
                
                parsedDates.forEach(parsed => {
                    const date = parsed.start.date();
                    const dateKey = DateTime.fromJSDate(date).toFormat('yyyy-MM-dd HH:mm');
                    
                    if (!this.unavailabilities.has(dateKey)) {
                        this.unavailabilities.set(dateKey, new Set());
                    }
                    this.unavailabilities.get(dateKey).add(message.author.id);
                    
                    // Store event data
                    this.events.set(message.id, {
                        messageId: message.id,
                        author: message.author.username,
                        userId: message.author.id,
                        date: date,
                        text: message.content,
                        type: 'unavailable',
                        channelId: message.channel.id
                    });
                });
            }
        }
    }
    
    removeAvailability(message) {
        const event = this.events.get(message.id);
        if (event) {
            const dateKey = DateTime.fromJSDate(event.date).toFormat('yyyy-MM-dd HH:mm');
            
            if (event.type === 'available' && this.availabilities.has(dateKey)) {
                this.availabilities.get(dateKey).delete(event.userId);
                if (this.availabilities.get(dateKey).size === 0) {
                    this.availabilities.delete(dateKey);
                }
            } else if (event.type === 'unavailable' && this.unavailabilities.has(dateKey)) {
                this.unavailabilities.get(dateKey).delete(event.userId);
                if (this.unavailabilities.get(dateKey).size === 0) {
                    this.unavailabilities.delete(dateKey);
                }
            }
            
            this.events.delete(message.id);
        }
    }
    
    async processCalendarCommand(source) {
        const channel = source.channel || await this.client.channels.fetch(source.channelId);
        const oneWeekAgo = DateTime.now().minus({ weeks: 1 });
        
        try {
            // Fetch and process messages
            const messages = await this.fetchChannelMessages(channel, oneWeekAgo);
            
            // Clear existing data for this channel
            this.clearChannelData(channel.id);
            
            // Process all messages
            messages.forEach(msg => this.extractAvailability(msg));
            
            // Display calendar
            await this.displayVisualCalendar(channel);
        } catch (error) {
            logger.error('Error in processCalendarCommand:', { 
                error: error.message, 
                stack: error.stack
            });
            throw error;
        }
    }
    
    clearChannelData(channelId) {
        // Clear events for this channel
        for (const [messageId, event] of this.events.entries()) {
            if (event.channelId === channelId) {
                this.removeAvailability({ id: messageId });
            }
        }
    }
    
    async fetchChannelMessages(channel, since) {
        let messages = [];
        let lastId = null;
        
        while (true) {
            const options = { limit: 100 };
            if (lastId) {
                options.before = lastId;
            }
            
            const fetchedMessages = await channel.messages.fetch(options);
            const relevantMessages = fetchedMessages.filter(msg => {
                const msgTime = DateTime.fromMillis(msg.createdTimestamp);
                return msgTime > since && !msg.author.bot;
            });
            
            messages = messages.concat(Array.from(relevantMessages.values()));
            
            if (fetchedMessages.size !== 100 || relevantMessages.size === 0) {
                break;
            }
            
            lastId = fetchedMessages.last().id;
        }
        
        return messages;
    }
    
    async displayVisualCalendar(channel) {
        const embed = this.generateVisualCalendarEmbed();
        
        try {
            const msg = await channel.send({ embeds: [embed] });
            this.calendarMessages.set(channel.id, msg.id);
            logger.info('Calendar displayed successfully', { channelId: channel.id });
        } catch (error) {
            logger.error('Error displaying calendar:', { 
                error: error.message, 
                stack: error.stack,
                channelId: channel.id
            });
            throw error;
        }
    }
    
    async updateCalendarDisplay(channel) {
        const calendarMessageId = this.calendarMessages.get(channel.id);
        if (!calendarMessageId) return;
        
        try {
            const calendarMessage = await channel.messages.fetch(calendarMessageId);
            const updatedEmbed = this.generateVisualCalendarEmbed();
            await calendarMessage.edit({ embeds: [updatedEmbed] });
        } catch (error) {
            logger.error('Error updating calendar:', { 
                error: error.message, 
                stack: error.stack,
                channelId: channel.id
            });
            this.calendarMessages.delete(channel.id);
        }
    }
    
    generateVisualCalendarEmbed() {
        const embed = new EmbedBuilder()
            .setTitle('📅 Availability Calendar')
            .setColor('#0099ff')
            .setTimestamp();
        
        // Get next 7 days for the visual calendar
        const today = DateTime.now().startOf('day');
        const days = [];
        
        for (let i = 0; i < 7; i++) {
            days.push(today.plus({ days: i }));
        }
        
        // Build calendar view
        let calendarView = '';
        
        days.forEach(day => {
            const dayStr = day.toFormat('yyyy-MM-dd');
            const dayName = day.toFormat('EEE, MMM d');
            
            // Get all time slots for this day
            const availableUsers = new Set();
            const unavailableUsers = new Set();
            
            // Check all availability entries that match this day
            for (const [dateKey, users] of this.availabilities) {
                if (dateKey.startsWith(dayStr)) {
                    users.forEach(userId => availableUsers.add(userId));
                }
            }
            
            for (const [dateKey, users] of this.unavailabilities) {
                if (dateKey.startsWith(dayStr)) {
                    users.forEach(userId => unavailableUsers.add(userId));
                }
            }
            
            // Create visual representation
            let statusEmoji = '📆';
            if (availableUsers.size > 0) {
                statusEmoji = '✅';
            } else if (unavailableUsers.size > 0) {
                statusEmoji = '❌';
            }
            
            calendarView += `${statusEmoji} **${dayName}**\n`;
            
            if (availableUsers.size > 0) {
                const availableUsernames = Array.from(availableUsers).map(userId => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                calendarView += `├ Available: ${availableUsernames.join(', ')}\n`;
            }
            
            if (unavailableUsers.size > 0) {
                const unavailableUsernames = Array.from(unavailableUsers).map(userId => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                calendarView += `├ Unavailable: ${unavailableUsernames.join(', ')}\n`;
            }
            
            if (availableUsers.size === 0 && unavailableUsers.size === 0) {
                calendarView += `├ No availability data\n`;
            }
            
            calendarView += '\n';
        });
        
        embed.setDescription(calendarView || 'No availability data found.');
        
        // Add instructions
        embed.addFields({
            name: '📝 How to Update',
            value: 'Say "I\'m available [date/time]" or "I\'m busy [date/time]" to update your schedule.\n' +
                   'Example: "I\'m available tomorrow at 7pm" or "I can\'t make it Friday"',
            inline: false
        });
        
        embed.setFooter({
            text: 'Calendar auto-updates when availability messages are added, edited, or deleted.'
        });
        
        return embed;
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