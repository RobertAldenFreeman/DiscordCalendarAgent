// handlers/CommandHandler.js
const { REST, Routes } = require('discord.js');
const logger = require('../utils/logger');

class CommandHandler {
    constructor(client, calendarService, availabilityService) {
        this.client = client;
        this.calendarService = calendarService;
        this.availabilityService = availabilityService;
    }
    
    async registerSlashCommands(token) {
        const commands = [
            {
                name: 'calendar',
                description: 'Display a visual calendar of availability'
            }
        ];
        
        const rest = new REST({ version: '10' }).setToken(token);
        
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
    
    async handleCalendarCommand(interaction) {
        logger.info('Calendar slash command received', { 
            guildId: interaction.guildId, 
            channelId: interaction.channelId, 
            userId: interaction.user.id 
        });
        
        // Reply immediately to prevent "thinking" state
        await interaction.reply({ content: 'Generating calendar...', ephemeral: true });
        
        try {
            const channel = await this.client.channels.fetch(interaction.channelId);
            
            // Clear existing data for this channel
            this.availabilityService.clearChannelData(channel.id);
            
            // Fetch and process messages
            const messages = await this.fetchChannelMessages(channel);
            messages.forEach(msg => this.availabilityService.extractAvailability(msg));
            
            // Display hourly calendar
            await this.calendarService.displayHourlyCalendar(channel, this.availabilityService);
            
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
    
    async fetchChannelMessages(channel) {
        const oneWeekAgo = require('luxon').DateTime.now().minus({ weeks: 1 });
        let messages = [];
        let lastId = null;
        
        while (true) {
            const options = { limit: 100 };
            if (lastId) {
                options.before = lastId;
            }
            
            const fetchedMessages = await channel.messages.fetch(options);
            const relevantMessages = fetchedMessages.filter(msg => {
                const msgTime = require('luxon').DateTime.fromMillis(msg.createdTimestamp);
                return msgTime > oneWeekAgo && !msg.author.bot;
            });
            
            messages = messages.concat(Array.from(relevantMessages.values()));
            
            if (fetchedMessages.size !== 100 || relevantMessages.size === 0) {
                break;
            }
            
            lastId = fetchedMessages.last().id;
        }
        
        return messages;
    }
}

module.exports = CommandHandler;