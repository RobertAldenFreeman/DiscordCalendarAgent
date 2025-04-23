// handlers/InteractionHandler.js
const { DateTime } = require('luxon');
const logger = require('../utils/logger');

class InteractionHandler {
    constructor(client, calendarService, availabilityService) {
        this.client = client;
        this.calendarService = calendarService;
        this.availabilityService = availabilityService;
    }
    
    async handle(interaction) {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'calendar') {
                const CommandHandler = require('./CommandHandler');
                await new CommandHandler(this.client, this.calendarService, this.availabilityService)
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
            case 'prev_week':
            case 'next_week':
            case 'today':
                await this.calendarService.handleNavigation(interaction, this.availabilityService);
                break;
            
            case 'edit_availability':
                await this.calendarService.showAvailabilityEditor(interaction, this.availabilityService);
                break;
            
            case 'save_availability':
                await this.calendarService.saveAvailability(interaction, this.availabilityService);
                break;
            
            case 'cancel_edit':
                await interaction.update({ content: 'Edit cancelled.', components: [], ephemeral: true });
                break;
            
            default:
                // Handle day selection buttons
                if (interaction.customId.startsWith('day_select_')) {
                    await this.calendarService.handleNavigation(interaction, this.availabilityService);
                }
                break;
        }
    }
    
    async handleSelectMenu(interaction) {
        switch (interaction.customId) {
            case 'view_select':
                await this.calendarService.handleViewChange(interaction, this.availabilityService);
                break;
            
            case 'select_start_time':
                this.calendarService.handleTimeSelection(interaction, 'start');
                await interaction.deferUpdate();
                break;
            
            case 'select_end_time':
                this.calendarService.handleTimeSelection(interaction, 'end');
                await interaction.deferUpdate();
                break;
            
            case 'select_status':
                this.calendarService.handleTimeSelection(interaction, 'status');
                await interaction.deferUpdate();
                break;
            
            case 'select_hours_1':
            case 'select_hours_2':
                // Legacy support
                await interaction.deferUpdate();
                break;
        }
    }
}

module.exports = InteractionHandler;