// services/CalendarService.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const { logger } = require('../index');

class CalendarService {
    constructor(client) {
        this.client = client;
        this.calendarMessages = new Map(); // channelId -> messageId
        this.currentViews = new Map(); // channelId -> { date, view }
    }
    
    async displayHourlyCalendar(channel, availabilityService, selectedDate = DateTime.now()) {
        const embed = this.generateHourlyCalendarEmbed(availabilityService, selectedDate);
        const components = this.generateCalendarComponents(selectedDate);
        
        try {
            const msg = await channel.send({ embeds: [embed], components });
            this.calendarMessages.set(channel.id, msg.id);
            this.currentViews.set(channel.id, { date: selectedDate, view: 'hourly' });
            logger.info('Hourly calendar displayed successfully', { channelId: channel.id });
            return msg;
        } catch (error) {
            logger.error('Error displaying hourly calendar:', { 
                error: error.message, 
                stack: error.stack,
                channelId: channel.id
            });
            throw error;
        }
    }
    
    generateHourlyCalendarEmbed(availabilityService, selectedDate) {
        const embed = new EmbedBuilder()
            .setTitle(`📅 Availability for ${selectedDate.toFormat('EEEE, MMMM d')}`)
            .setColor('#0099ff')
            .setTimestamp();
        
        // Get availability for each hour of the selected day
        const dayStart = selectedDate.startOf('day');
        let availabilityView = '';
        
        for (let hour = 8; hour <= 23; hour++) { // 8 AM to 11 PM
            const timeSlot = dayStart.plus({ hours: hour });
            const timeKey = timeSlot.toFormat('yyyy-MM-dd HH:mm');
            const timeDisplay = timeSlot.toFormat('h:mm a');
            
            const available = availabilityService.getAvailableUsers(timeKey);
            const unavailable = availabilityService.getUnavailableUsers(timeKey);
            
            // Visual status indicator
            let status = '⬜'; // No data
            if (available.size > 0 && unavailable.size === 0) status = '🟩'; // Available
            else if (available.size > 0 && unavailable.size > 0) status = '🟨'; // Mixed
            else if (unavailable.size > 0) status = '🟥'; // Unavailable
            
            availabilityView += `${status} **${timeDisplay}**\n`;
            
            if (available.size > 0) {
                const availableUsers = Array.from(available).map(userId => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                availabilityView += `  ✅ ${availableUsers.join(', ')}\n`;
            }
            
            if (unavailable.size > 0) {
                const unavailableUsers = Array.from(unavailable).map(userId => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                availabilityView += `  ❌ ${unavailableUsers.join(', ')}\n`;
            }
            
            if (available.size === 0 && unavailable.size === 0) {
                availabilityView += `  ⚪ No data\n`;
            }
            
            availabilityView += '\n';
        }
        
        embed.setDescription(availabilityView || 'No availability data for this day.');
        
        // Add legend
        embed.addFields({
            name: '🗝️ Legend',
            value: '🟩 All Available | 🟥 All Unavailable | 🟨 Mixed | ⬜ No Data',
            inline: false
        });
        
        return embed;
    }
    
    generateCalendarComponents(selectedDate) {
        // Navigation buttons
        const navigationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_day')
                    .setLabel('◀️ Previous Day')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('today')
                    .setLabel('Today')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('next_day')
                    .setLabel('Next Day ▶️')
                    .setStyle(ButtonStyle.Primary)
            );
        
        // View options
        const viewRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('view_select')
                    .setPlaceholder('Change View')
                    .addOptions([
                        {
                            label: 'Hourly View',
                            description: 'Show availability by hour',
                            value: 'hourly',
                            default: true
                        },
                        {
                            label: 'Weekly View',
                            description: 'Show availability for the week',
                            value: 'weekly'
                        }
                    ])
            );
        
        // Edit availability button
        const editRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('edit_availability')
                    .setLabel('📝 Edit My Availability')
                    .setStyle(ButtonStyle.Success)
            );
        
        return [navigationRow, viewRow, editRow];
    }
    
    async updateCalendarDisplay(channel, availabilityService) {
        const messageId = this.calendarMessages.get(channel.id);
        const view = this.currentViews.get(channel.id);
        
        if (!messageId || !view) return;
        
        try {
            const message = await channel.messages.fetch(messageId);
            const embed = this.generateHourlyCalendarEmbed(availabilityService, view.date);
            const components = this.generateCalendarComponents(view.date);
            
            await message.edit({ embeds: [embed], components });
        } catch (error) {
            logger.error('Error updating calendar:', { 
                error: error.message, 
                stack: error.stack,
                channelId: channel.id
            });
            this.calendarMessages.delete(channel.id);
            this.currentViews.delete(channel.id);
        }
    }
    
    async handleNavigation(interaction, availabilityService) {
        const channelView = this.currentViews.get(interaction.channelId);
        if (!channelView) return;
        
        let newDate = channelView.date;
        
        switch (interaction.customId) {
            case 'prev_day':
                newDate = newDate.minus({ days: 1 });
                break;
            case 'next_day':
                newDate = newDate.plus({ days: 1 });
                break;
            case 'today':
                newDate = DateTime.now();
                break;
        }
        
        this.currentViews.set(interaction.channelId, { ...channelView, date: newDate });
        
        const embed = this.generateHourlyCalendarEmbed(availabilityService, newDate);
        const components = this.generateCalendarComponents(newDate);
        
        await interaction.update({ embeds: [embed], components });
    }
    
    async showAvailabilityEditor(interaction, availabilityService) {
        const channelView = this.currentViews.get(interaction.channelId);
        if (!channelView) return;
        
        const currentAvailability = availabilityService.getUserAvailability(interaction.user.id, channelView.date);
        
        // Create hour selector
        const hourRow1 = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_hours_1')
                    .setPlaceholder('Select availability (8 AM - 2 PM)')
                    .setMinValues(0)
                    .setMaxValues(7)
                    .addOptions(
                        Array.from({ length: 7 }, (_, i) => {
                            const hour = 8 + i;
                            const time = DateTime.fromObject({ hour });
                            return {
                                label: time.toFormat('h:mm a'),
                                value: `${hour}`,
                                default: currentAvailability.available.has(hour)
                            };
                        })
                    )
            );
        
        const hourRow2 = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_hours_2')
                    .setPlaceholder('Select availability (3 PM - 11 PM)')
                    .setMinValues(0)
                    .setMaxValues(9)
                    .addOptions(
                        Array.from({ length: 9 }, (_, i) => {
                            const hour = 15 + i;
                            const time = DateTime.fromObject({ hour });
                            return {
                                label: time.toFormat('h:mm a'),
                                value: `${hour}`,
                                default: currentAvailability.available.has(hour)
                            };
                        })
                    )
            );
        
        const saveRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('save_availability')
                    .setLabel('💾 Save')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('cancel_edit')
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.reply({
            content: `Edit your availability for ${channelView.date.toFormat('EEEE, MMMM d')}:`,
            components: [hourRow1, hourRow2, saveRow],
            ephemeral: true
        });
    }
    
    generateWeeklyView(availabilityService, startDate) {
        const embed = new EmbedBuilder()
            .setTitle(`📅 Weekly Availability`)
            .setColor('#0099ff')
            .setTimestamp();
        
        let weekView = '';
        
        for (let i = 0; i < 7; i++) {
            const day = startDate.plus({ days: i });
            const dayStr = day.toFormat('yyyy-MM-dd');
            const dayName = day.toFormat('EEE, MMM d');
            
            const availableCount = availabilityService.getDayAvailableCount(dayStr);
            const unavailableCount = availabilityService.getDayUnavailableCount(dayStr);
            
            let status = '📆';
            if (availableCount > 0 && unavailableCount === 0) status = '✅';
            else if (availableCount > 0 && unavailableCount > 0) status = '⚡';
            else if (unavailableCount > 0) status = '❌';
            
            weekView += `${status} **${dayName}**: ${availableCount} available, ${unavailableCount} unavailable\n`;
        }
        
        embed.setDescription(weekView);
        return embed;
    }
}

module.exports = CalendarService;