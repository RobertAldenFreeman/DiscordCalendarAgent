// services/CalendarService.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const logger = require('../utils/logger');

class CalendarService {
    constructor(client) {
        this.client = client;
        // Use nested Maps to separate data by guild
        this.calendarMessages = new Map(); // guildId -> channelId -> messageId
        this.currentViews = new Map(); // guildId -> channelId -> { date, view }
        this.tempAvailability = new Map(); // userId -> { guildId, date, availableStart, availableEnd, status }
        this.mentionedNames = new Map(); // guildId -> name -> availability data
    }
    
    // Initialize guild data if it doesn't exist
    initializeGuildData(guildId) {
        if (!this.calendarMessages.has(guildId)) {
            this.calendarMessages.set(guildId, new Map());
        }
        if (!this.currentViews.has(guildId)) {
            this.currentViews.set(guildId, new Map());
        }
        if (!this.mentionedNames.has(guildId)) {
            this.mentionedNames.set(guildId, new Map());
        }
    }
    
    async displayCalendar(channel, availabilityService, selectedDate = DateTime.now()) {
        const guildId = channel.guild?.id;
        if (!guildId) return;
        
        this.initializeGuildData(guildId);
        
        // Default to weekly view first
        const embed = this.generateWeeklyView(guildId, availabilityService, selectedDate.startOf('week'));
        const components = this.generateCalendarComponents(selectedDate, 'weekly');
        
        try {
            const msg = await channel.send({ embeds: [embed], components });
            
            const guildCalendarMessages = this.calendarMessages.get(guildId);
            guildCalendarMessages.set(channel.id, msg.id);
            
            const guildCurrentViews = this.currentViews.get(guildId);
            guildCurrentViews.set(channel.id, { date: selectedDate, view: 'weekly' });
            
            logger.info('Calendar displayed successfully', { 
                guildId: guildId,
                channelId: channel.id,
                view: 'weekly'
            });
            return msg;
        } catch (error) {
            logger.error('Error displaying calendar:', {
                error: error.message, 
                stack: error.stack,
                guildId: guildId,
                channelId: channel.id
            });
            throw error;
        }
    }
    
    generateWeeklyView(guildId, availabilityService, startDate) {
        const embed = new EmbedBuilder()
            .setTitle(`📅 Weekly Calendar - ${startDate.toFormat('MMM d')} to ${startDate.plus({ days: 6 }).toFormat('MMM d, yyyy')}`)
            .setColor('#0099ff')
            .setTimestamp();
        
        let weekView = '';
        const availabilityByDay = new Map(); // day -> { users: {userId: 'available'|'unavailable'}, nonUsers: {name: 'available'|'unavailable'} }
        
        // Collect all availability data
        for (let i = 0; i < 7; i++) {
            const day = startDate.plus({ days: i });
            const dayStr = day.toFormat('yyyy-MM-dd');
            availabilityByDay.set(dayStr, { users: {}, nonUsers: {} });
            
            // Get registered users
            const available = availabilityService.getAllAvailableUsers(guildId, dayStr);
            const unavailable = availabilityService.getAllUnavailableUsers(guildId, dayStr);
            
            available.forEach(userId => {
                availabilityByDay.get(dayStr).users[userId] = 'available';
            });
            
            unavailable.forEach(userId => {
                availabilityByDay.get(dayStr).users[userId] = 'unavailable';
            });
            
            // Get mentioned non-users
            if (this.mentionedNames.has(guildId)) {
                const guildMentionedNames = this.mentionedNames.get(guildId);
                guildMentionedNames.forEach((data, name) => {
                    if (data.dates && data.dates.has(dayStr)) {
                        availabilityByDay.get(dayStr).nonUsers[name] = data.dates.get(dayStr);
                    }
                });
            }
        }
        
        // Build the calendar view
        for (let i = 0; i < 7; i++) {
            const day = startDate.plus({ days: i });
            const dayStr = day.toFormat('yyyy-MM-dd');
            const dayName = day.toFormat('ddd, MMM d');
            const isToday = day.hasSame(DateTime.now(), 'day');
            
            const availabilityData = availabilityByDay.get(dayStr);
            const availableUsers = Object.entries(availabilityData.users)
                .filter(([userId, status]) => status === 'available')
                .map(([userId]) => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                
            const unavailableUsers = Object.entries(availabilityData.users)
                .filter(([userId, status]) => status === 'unavailable')
                .map(([userId]) => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                
            const availableNonUsers = Object.entries(availabilityData.nonUsers)
                .filter(([name, status]) => status === 'available')
                .map(([name]) => name);
                
            const unavailableNonUsers = Object.entries(availabilityData.nonUsers)
                .filter(([name, status]) => status === 'unavailable')
                .map(([name]) => name);
                
            const totalAvailable = availableUsers.length + availableNonUsers.length;
            const totalUnavailable = unavailableUsers.length + unavailableNonUsers.length;
            
            // Status emoji based on availability
            let status = '📆';
            if (totalAvailable > 0 && totalUnavailable === 0) status = '✅';
            else if (totalAvailable > 0 && totalUnavailable > 0) status = '⚠️';
            else if (totalUnavailable > 0) status = '❌';
            if (isToday) status = '🔵'; // Highlight today
            
            const dayTitle = isToday ? `**${dayName} (Today)**` : `**${dayName}**`;
            weekView += `${status} ${dayTitle}`;
            
            // Add availability counts
            if (totalAvailable > 0 || totalUnavailable > 0) {
                weekView += ` - `;
                
                if (totalAvailable > 0) {
                    weekView += `✅ ${totalAvailable}`;
                }
                
                if (totalAvailable > 0 && totalUnavailable > 0) {
                    weekView += ` | `;
                }
                
                if (totalUnavailable > 0) {
                    weekView += `❌ ${totalUnavailable}`;
                }
            }
            
            weekView += `\n`;
            
            // Add details if there are any availabilities
            if (availableUsers.length > 0 || availableNonUsers.length > 0) {
                const allAvailable = [...availableUsers, ...availableNonUsers];
                weekView += `  ✅ ${allAvailable.join(', ')}\n`;
            }
            
            if (unavailableUsers.length > 0 || unavailableNonUsers.length > 0) {
                const allUnavailable = [...unavailableUsers, ...unavailableNonUsers];
                weekView += `  ❌ ${allUnavailable.join(', ')}\n`;
            }
            
            weekView += '\n';
        }
        
        embed.setDescription(weekView);
        
        // Add legend and instructions
        embed.addFields({
            name: '📋 Instructions',
            value: 'Click on a day to see hourly availability\nSay "I\'m available tomorrow" or "Alex can\'t make it Friday" to update',
            inline: false
        });
        
        embed.addFields({
            name: '🗝️ Legend',
            value: '✅ Available | ❌ Unavailable | ⚠️ Mixed | 📆 No Data | 🔵 Today',
            inline: false
        });
        
        return embed;
    }
    
    generateHourlyCalendarEmbed(guildId, availabilityService, selectedDate) {
        const embed = new EmbedBuilder()
            .setTitle(`📅 ${selectedDate.toFormat('EEEE, MMMM d, yyyy')} - Hourly Availability`)
            .setColor('#0099ff')
            .setTimestamp();
        
        // Get availability for each hour of the selected day
        const dayStart = selectedDate.startOf('day');
        let availabilityView = '';
        const dayStr = selectedDate.toFormat('yyyy-MM-dd');
        
        for (let hour = 8; hour <= 23; hour++) { // 8 AM to 11 PM
            const timeSlot = dayStart.plus({ hours: hour });
            const timeKey = timeSlot.toFormat('yyyy-MM-dd HH:mm');
            const timeDisplay = timeSlot.toFormat('h:mm a');
            
            const available = availabilityService.getAvailableUsers(guildId, timeKey);
            const unavailable = availabilityService.getUnavailableUsers(guildId, timeKey);
            
            // Also include mentioned non-user names
            const availableNonUsers = [];
            const unavailableNonUsers = [];
            
            if (this.mentionedNames.has(guildId)) {
                const guildMentionedNames = this.mentionedNames.get(guildId);
                guildMentionedNames.forEach((data, name) => {
                    if (data.dates && data.dates.has(dayStr) && data.hours && data.hours.has(hour)) {
                        const status = data.dates.get(dayStr);
                        if (status === 'available') {
                            availableNonUsers.push(name);
                        } else if (status === 'unavailable') {
                            unavailableNonUsers.push(name);
                        }
                    }
                });
            }
            
            // Visual status indicator
            let status = '⬜'; // No data
            const totalAvailable = available.size + availableNonUsers.length;
            const totalUnavailable = unavailable.size + unavailableNonUsers.length;
            
            if (totalAvailable > 0 && totalUnavailable === 0) status = '🟩'; // Available
            else if (totalAvailable > 0 && totalUnavailable > 0) status = '🟨'; // Mixed
            else if (totalUnavailable > 0) status = '🟥'; // Unavailable
            
            availabilityView += `${status} **${timeDisplay}**\n`;
            
            if (available.size > 0 || availableNonUsers.length > 0) {
                const availableUsers = Array.from(available).map(userId => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                
                const allAvailable = [...availableUsers, ...availableNonUsers];
                availabilityView += `  ✅ ${allAvailable.join(', ')}\n`;
            }
            
            if (unavailable.size > 0 || unavailableNonUsers.length > 0) {
                const unavailableUsers = Array.from(unavailable).map(userId => {
                    const user = this.client.users.cache.get(userId);
                    return user ? user.username : userId;
                });
                
                const allUnavailable = [...unavailableUsers, ...unavailableNonUsers];
                availabilityView += `  ❌ ${allUnavailable.join(', ')}\n`;
            }
            
            if (totalAvailable === 0 && totalUnavailable === 0) {
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
    
    generateCalendarComponents(selectedDate, view = 'weekly') {
        const components = [];
        
        // Navigation buttons
        const navigationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_' + (view === 'weekly' ? 'week' : 'day'))
                    .setLabel(view === 'weekly' ? '◀️ Previous Week' : '◀️ Previous Day')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('today')
                    .setLabel('Today')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('next_' + (view === 'weekly' ? 'week' : 'day'))
                    .setLabel(view === 'weekly' ? 'Next Week ▶️' : 'Next Day ▶️')
                    .setStyle(ButtonStyle.Primary)
            );
        
        components.push(navigationRow);
        
        // Day selection buttons (for weekly view)
        if (view === 'weekly') {
            const daySelectRow1 = new ActionRowBuilder();
            const daySelectRow2 = new ActionRowBuilder();
            const startOfWeek = selectedDate.startOf('week');
            
            // First row - Monday through Wednesday (3 days)
            for (let i = 0; i < 3; i++) {
                const day = startOfWeek.plus({ days: i });
                const isToday = day.hasSame(DateTime.now(), 'day');
                
                daySelectRow1.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`day_select_${i}`)
                        .setLabel(day.toFormat('ccc d'))
                        .setStyle(isToday ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
            }
            
            // Second row - Thursday through Sunday (4 days)
            for (let i = 3; i < 7; i++) {
                const day = startOfWeek.plus({ days: i });
                const isToday = day.hasSame(DateTime.now(), 'day');
                
                daySelectRow2.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`day_select_${i}`)
                        .setLabel(day.toFormat('ccc d'))
                        .setStyle(isToday ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
            }
            
            components.push(daySelectRow1);
            components.push(daySelectRow2);
        }
        
        // View switcher
        const viewRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('view_select')
                    .setPlaceholder('Change View')
                    .addOptions([
                        {
                            label: 'Weekly View',
                            description: 'Show availability for the week',
                            value: 'weekly',
                            default: view === 'weekly'
                        },
                        {
                            label: 'Hourly View',
                            description: 'Show availability by hour',
                            value: 'hourly',
                            default: view === 'hourly'
                        }
                    ])
            );
        
        components.push(viewRow);
        
        // Edit availability button
        const editRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('edit_availability')
                    .setLabel('📝 Edit My Availability')
                    .setStyle(ButtonStyle.Success)
            );
        
        components.push(editRow);
        
        return components;
    }
    
    async updateCalendarDisplay(channel, availabilityService) {
        const guildId = channel.guild?.id;
        if (!guildId) return;
        
        const guildCalendarMessages = this.calendarMessages.get(guildId);
        const guildCurrentViews = this.currentViews.get(guildId);
        
        if (!guildCalendarMessages || !guildCurrentViews) return;
        
        const messageId = guildCalendarMessages.get(channel.id);
        const view = guildCurrentViews.get(channel.id);
        
        if (!messageId || !view) return;
        
        try {
            const message = await channel.messages.fetch(messageId);
            
            // Generate appropriate embed based on current view
            let embed, components;
            if (view.view === 'hourly') {
                embed = this.generateHourlyCalendarEmbed(guildId, availabilityService, view.date);
                components = this.generateCalendarComponents(view.date, 'hourly');
            } else {
                embed = this.generateWeeklyView(guildId, availabilityService, view.date.startOf('week'));
                components = this.generateCalendarComponents(view.date, 'weekly');
            }
            
            await message.edit({ embeds: [embed], components });
        } catch (error) {
            logger.error('Error updating calendar:', { 
                error: error.message, 
                stack: error.stack,
                guildId: guildId,
                channelId: channel.id
            });
            guildCalendarMessages.delete(channel.id);
            guildCurrentViews.delete(channel.id);
        }
    }
    
    async handleNavigation(interaction, availabilityService) {
        const guildId = interaction.guildId;
        if (!guildId) return;
        
        const guildCurrentViews = this.currentViews.get(guildId);
        if (!guildCurrentViews) return;
        
        const channelView = guildCurrentViews.get(interaction.channelId);
        if (!channelView) return;
        
        let newDate = channelView.date;
        let currentView = channelView.view;
        
        // Handle navigation
        switch (interaction.customId) {
            case 'prev_day':
                newDate = newDate.minus({ days: 1 });
                break;
            case 'next_day':
                newDate = newDate.plus({ days: 1 });
                break;
            case 'prev_week':
                newDate = newDate.minus({ weeks: 1 });
                break;
            case 'next_week':
                newDate = newDate.plus({ weeks: 1 });
                break;
            case 'today':
                newDate = DateTime.now();
                break;
            default:
                // Handle day selection buttons
                if (interaction.customId.startsWith('day_select_')) {
                    const dayIndex = parseInt(interaction.customId.replace('day_select_', ''));
                    const startOfWeek = channelView.date.startOf('week');
                    newDate = startOfWeek.plus({ days: dayIndex });
                    currentView = 'hourly'; // Switch to hourly view when selecting a day
                }
                break;
        }
        
        guildCurrentViews.set(interaction.channelId, { date: newDate, view: currentView });
        
        // Update the view
        let embed, components;
        if (currentView === 'hourly') {
            embed = this.generateHourlyCalendarEmbed(guildId, availabilityService, newDate);
            components = this.generateCalendarComponents(newDate, 'hourly');
        } else {
            embed = this.generateWeeklyView(guildId, availabilityService, newDate.startOf('week'));
            components = this.generateCalendarComponents(newDate, 'weekly');
        }
        
        await interaction.update({ embeds: [embed], components });
    }
    
    async handleViewChange(interaction, availabilityService) {
        const guildId = interaction.guildId;
        if (!guildId) return;
        
        const guildCurrentViews = this.currentViews.get(guildId);
        if (!guildCurrentViews) return;
        
        const channelView = guildCurrentViews.get(interaction.channelId);
        if (!channelView) return;
        
        const view = interaction.values[0];
        
        // Update the current view
        guildCurrentViews.set(interaction.channelId, { date: channelView.date, view });
        
        // Generate appropriate embed and components
        let embed, components;
        if (view === 'hourly') {
            embed = this.generateHourlyCalendarEmbed(guildId, availabilityService, channelView.date);
            components = this.generateCalendarComponents(channelView.date, 'hourly');
        } else {
            embed = this.generateWeeklyView(guildId, availabilityService, channelView.date.startOf('week'));
            components = this.generateCalendarComponents(channelView.date, 'weekly');
        }
        
        await interaction.update({ embeds: [embed], components });
    }
    
    async showAvailabilityEditor(interaction, availabilityService) {
        const guildId = interaction.guildId;
        if (!guildId) return;
        
        const guildCurrentViews = this.currentViews.get(guildId);
        if (!guildCurrentViews) return;
        
        const channelView = guildCurrentViews.get(interaction.channelId);
        if (!channelView) return;
        
        // Create time range selectors
        const dateStr = channelView.date.toFormat('EEEE, MMMM d');
        
        // Start time selector
        const startTimeRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_start_time')
                    .setPlaceholder('Select start time')
                    .addOptions(
                        Array.from({ length: 16 }, (_, i) => {
                            const hour = 8 + i;
                            const time = DateTime.fromObject({ hour });
                            return {
                                label: time.toFormat('h:mm a'),
                                value: `${hour}`,
                            };
                        })
                    )
            );
        
        // End time selector
        const endTimeRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_end_time')
                    .setPlaceholder('Select end time')
                    .addOptions(
                        Array.from({ length: 16 }, (_, i) => {
                            const hour = 8 + i;
                            const time = DateTime.fromObject({ hour });
                            return {
                                label: time.toFormat('h:mm a'),
                                value: `${hour}`,
                            };
                        })
                    )
            );
        
        // Availability status selector
        const statusRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_status')
                    .setPlaceholder('Select availability status')
                    .addOptions([
                        {
                            label: '✅ Available',
                            description: 'I can attend during this time',
                            value: 'available',
                        },
                        {
                            label: '❌ Unavailable',
                            description: 'I cannot attend during this time',
                            value: 'unavailable',
                        }
                    ])
            );
        
        // Save/Cancel buttons
        const actionRow = new ActionRowBuilder()
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
        
        // Store the date for later reference
        this.tempAvailability.set(interaction.user.id, {
            guildId,
            date: channelView.date,
            availableStart: null,
            availableEnd: null,
            status: null
        });
        
        await interaction.reply({
            content: `Edit your availability for ${dateStr}:`,
            components: [startTimeRow, endTimeRow, statusRow, actionRow],
            ephemeral: true
        });
    }
    
    handleTimeSelection(interaction, type) {
        const userId = interaction.user.id;
        if (!this.tempAvailability.has(userId)) return false;
        
        const temp = this.tempAvailability.get(userId);
        const hour = parseInt(interaction.values[0]);
        
        if (type === 'start') {
            temp.availableStart = hour;
        } else if (type === 'end') {
            temp.availableEnd = hour;
        } else if (type === 'status') {
            temp.status = interaction.values[0];
        }
        
        return true;
    }
    
    async saveAvailability(interaction, availabilityService) {
        const userId = interaction.user.id;
        if (!this.tempAvailability.has(userId)) {
            await interaction.update({ 
                content: 'No availability data found. Please try again.', 
                components: [],
                ephemeral: true
            });
            return;
        }
        
        const temp = this.tempAvailability.get(userId);
        
        // Validate inputs
        if (!temp.availableStart || !temp.availableEnd || !temp.status) {
            await interaction.update({ 
                content: 'Please select both start time, end time, and availability status.',
                ephemeral: true
            });
            return;
        }
        
        // Make sure end time is after start time
        if (temp.availableEnd < temp.availableStart) {
            await interaction.update({ 
                content: 'End time must be after start time. Please try again.',
                ephemeral: true
            });
            return;
        }
        
        // Generate the list of hours in the selected range
        const availableHours = [];
        const unavailableHours = [];
        
        for (let hour = temp.availableStart; hour <= temp.availableEnd; hour++) {
            if (temp.status === 'available') {
                availableHours.push(hour);
            } else {
                unavailableHours.push(hour);
            }
        }
        
        // Update availability data
        availabilityService.setUserAvailability(
            temp.guildId,
            userId,
            temp.date,
            availableHours,
            unavailableHours
        );
        
        // Update calendar display
        const channel = await this.client.channels.fetch(interaction.channelId);
        await this.updateCalendarDisplay(channel, availabilityService);
        
        // Clear temporary data
        this.tempAvailability.delete(userId);
        
        // Confirm to user
        const statusEmoji = temp.status === 'available' ? '✅' : '❌';
        const startTime = DateTime.fromObject({ hour: temp.availableStart }).toFormat('h:mm a');
        const endTime = DateTime.fromObject({ hour: temp.availableEnd }).toFormat('h:mm a');
        
        await interaction.update({ 
            content: `${statusEmoji} Your availability for ${temp.date.toFormat('EEEE, MMMM d')} has been updated!\n` +
                    `You are ${temp.status} from ${startTime} to ${endTime}.`,
            components: [],
            ephemeral: true 
        });
    }
    
    // Method to add mentioned non-user availabilities
    addMentionedAvailability(guildId, name, date, status, hours) {
        this.initializeGuildData(guildId);
        const guildMentionedNames = this.mentionedNames.get(guildId);
        
        if (!guildMentionedNames.has(name)) {
            guildMentionedNames.set(name, {
                dates: new Map(),
                hours: new Set()
            });
        }
        
        const nameData = guildMentionedNames.get(name);
        nameData.dates.set(date.toFormat('yyyy-MM-dd'), status);
        
        if (hours && hours.length > 0) {
            hours.forEach(hour => nameData.hours.add(hour));
        } else {
            // Default to all hours if not specified
            for (let hour = 8; hour <= 23; hour++) {
                nameData.hours.add(hour);
            }
        }
    }
}

module.exports = CalendarService;