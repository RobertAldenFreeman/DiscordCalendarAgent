// handlers/InteractionHandler.js
const { logger } = require('../index');
const { DateTime } = require('luxon');

class InteractionHandler {
    constructor(client, calendarService, availabilityService) {
        this.client = client;
        this.calendarService = calendarService;
        this.availabilityService = availabilityService;
        this.tempAvailability = new Map(); // userId -> { available: Set, unavailable: Set }
    }
    
    async handle(interaction) {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'calendar') {
                const commandHandler = require('./CommandHandler');
                await new commandHandler(this.client, this.calendarService, this.availabilityService)
                    .handleCalendarCommand(interaction);
            }
            return;
        }
        
        if (interaction.isButton()) {
            await this.handleButton(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await this.handleSelectMenu(interaction);
        }
    }
    
    async handleButton(interaction) {
        switch (interaction.customId) {
            case 'prev_day':
            case 'next_day':
            case 'today':
                await this.calendarService.handleNavigation(interaction, this.availabilityService);
                break;
            
            case 'edit_availability':
                await this.calendarService.showAvailabilityEditor(interaction, this.availabilityService);
                break;
            
            case 'save_availability':
                await this.saveAvailability(interaction);
                break;
            
            case 'cancel_edit':
                await interaction.update({ content: 'Edit cancelled.', components: [], ephemeral: true });
                this.tempAvailability.delete(interaction.user.id);
                break;
        }
    }
    
    async handleSelectMenu(interaction) {
        switch (interaction.customId) {
            case 'view_select':
                await this.handleViewChange(interaction);
                break;
            
            case 'select_hours_1':
            case 'select_hours_2':
                await this.handleHourSelection(interaction);
                break;
        }
    }
    
    async handleViewChange(interaction) {
        const view = interaction.values[0];
        const channelView = this.calendarService.currentViews.get(interaction.channelId);
        
        if (!channelView) return;
        
        if (view === 'weekly') {
            const weeklyEmbed = this.calendarService.generateWeeklyView(
                this.availabilityService,
                channelView.date.startOf('week')
            );
            await interaction.update({ embeds: [weeklyEmbed] });
        } else {
            const hourlyEmbed = this.calendarService.generateHourlyCalendarEmbed(
                this.availabilityService,
                channelView.date
            );
            const components = this.calendarService.generateCalendarComponents(channelView.date);
            await interaction.update({ embeds: [hourlyEmbed], components });
        }
    }
    
    async handleHourSelection(interaction) {
        const userId = interaction.user.id;
        const selectedHours = interaction.values.map(v => parseInt(v));
        
        if (!this.tempAvailability.has(userId)) {
            const channelView = this.calendarService.currentViews.get(interaction.channelId);
            const currentAvailability = this.availabilityService.getUserAvailability(userId, channelView.date);
            
            this.tempAvailability.set(userId, {
                available: new Set(currentAvailability.available),
                unavailable: new Set(currentAvailability.unavailable),
                date: channelView.date
            });
        }
        
        const temp = this.tempAvailability.get(userId);
        
        // Handle hour range based on which selector was used
        if (interaction.customId === 'select_hours_1') {
            // 8 AM - 2 PM (hours 8-14)
            for (let hour = 8; hour <= 14; hour++) {
                if (selectedHours.includes(hour)) {
                    temp.available.add(hour);
                    temp.unavailable.delete(hour);
                } else {
                    temp.available.delete(hour);
                }
            }
        } else {
            // 3 PM - 11 PM (hours 15-23)
            for (let hour = 15; hour <= 23; hour++) {
                if (selectedHours.includes(hour)) {
                    temp.available.add(hour);
                    temp.unavailable.delete(hour);
                } else {
                    temp.available.delete(hour);
                }
            }
        }
        
        await interaction.deferUpdate(); // No visual update needed
    }
    
    async saveAvailability(interaction) {
        const userId = interaction.user.id;
        const temp = this.tempAvailability.get(userId);
        
        if (!temp) {
            await interaction.update({ content: 'No changes to save.', components: [], ephemeral: true });
            return;
        }
        
        // Convert Sets to Arrays for the service
        const availableHours = Array.from(temp.available);
        const unavailableHours = Array.from(temp.unavailable);
        
        this.availabilityService.setUserAvailability(userId, temp.date, availableHours, unavailableHours);
        
        // Update the main calendar display
        const channel = await this.client.channels.fetch(interaction.channelId);
        await this.calendarService.updateCalendarDisplay(channel, this.availabilityService);
        
        // Clear temporary data
        this.tempAvailability.delete(userId);
        
        await interaction.update({ 
            content: `✅ Your availability for ${temp.date.toFormat('EEEE, MMMM d')} has been updated!`, 
            components: [],
            ephemeral: true 
        });
    }
}

module.exports = InteractionHandler;