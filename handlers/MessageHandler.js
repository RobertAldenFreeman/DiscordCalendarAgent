// handlers/MessageHandler.js
const { logger } = require('../index');

class MessageHandler {
    constructor(client, calendarService, availabilityService) {
        this.client = client;
        this.calendarService = calendarService;
        this.availabilityService = availabilityService;
    }
    
    async handle(message) {
        if (message.author.bot) return;
        
        if (message.content.startsWith('!calendar')) {
            try {
                await this.handleTextCalendarCommand(message);
            } catch (error) {
                logger.error('Error handling message command:', { 
                    error: error.message, 
                    stack: error.stack
                });
                
                await message.reply(`An error occurred: ${error.message}`);
            }
        } else {
            // Extract availability from regular messages
            this.availabilityService.extractAvailability(message);
            
            // Update calendar if one is displayed
            await this.calendarService.updateCalendarDisplay(message.channel, this.availabilityService);
        }
    }
    
    async handleUpdate(oldMessage, newMessage) {
        if (newMessage.author.bot) return;
        
        try {
            // Remove old availability
            this.availabilityService.removeAvailability(oldMessage);
            
            // Extract new availability
            this.availabilityService.extractAvailability(newMessage);
            
            // Update calendar if displayed
            await this.calendarService.updateCalendarDisplay(newMessage.channel, this.availabilityService);
        } catch (error) {
            logger.error('Error handling message update:', { 
                error: error.message, 
                stack: error.stack
            });
        }
    }
    
    async handleDelete(message) {
        if (message.author.bot) return;
        
        try {
            // Remove availability
            this.availabilityService.removeAvailability(message);
            
            // Update calendar if displayed
            await this.calendarService.updateCalendarDisplay(message.channel, this.availabilityService);
        } catch (error) {
            logger.error('Error handling message delete:', { 
                error: error.message, 
                stack: error.stack
            });
        }
    }
    
    async handleTextCalendarCommand(message) {
        try {
            // Clear existing data for this channel
            this.availabilityService.clearChannelData(message.channel.id);
            
            // Fetch and process messages
            const messages = await this.fetchChannelMessages(message.channel);
            messages.forEach(msg => this.availabilityService.extractAvailability(msg));
            
            // Display hourly calendar
            await this.calendarService.displayHourlyCalendar(message.channel, this.availabilityService);
        } catch (error) {
            logger.error('Error processing text calendar command:', { 
                error: error.message, 
                stack: error.stack
            });
            throw error;
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

module.exports = MessageHandler;