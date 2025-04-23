// services/AvailabilityService.js
const { DateTime } = require('luxon');
const chrono = require('chrono-node');
const logger = require('../utils/logger');

class AvailabilityService {
    constructor() {
        // Use nested Maps to separate data by guild
        this.availabilities = new Map(); // guildId -> timeKey -> Set of userIds
        this.unavailabilities = new Map(); // guildId -> timeKey -> Set of userIds
        this.events = new Map(); // guildId -> messageId -> event data
        this.userAvailability = new Map(); // guildId -> userId -> date -> { available: Set<hour>, unavailable: Set<hour> }
    }
    
    // Initialize guild data if it doesn't exist
    initializeGuildData(guildId) {
        if (!this.availabilities.has(guildId)) {
            this.availabilities.set(guildId, new Map());
        }
        if (!this.unavailabilities.has(guildId)) {
            this.unavailabilities.set(guildId, new Map());
        }
        if (!this.events.has(guildId)) {
            this.events.set(guildId, new Map());
        }
        if (!this.userAvailability.has(guildId)) {
            this.userAvailability.set(guildId, new Map());
        }
    }
    
    extractAvailability(message) {
        const guildId = message.guild?.id;
        if (!guildId) return; // Direct messages not supported
        
        this.initializeGuildData(guildId);
        
        const content = message.content.toLowerCase();
        
        // Patterns for user and other people availability
        const availabilityPatterns = [
            // Self available
            { regex: /(?:i'?m\s+)?(?:available|free)\s+(?:on\s+)?(.+)/i, type: 'available', person: 'self' },
            { regex: /(?:i\s+)?can\s+(?:do|make|play|attend)\s+(?:it\s+)?(?:on\s+)?(.+)/i, type: 'available', person: 'self' },
            
            // Self unavailable
            { regex: /(?:i'?m\s+)?(?:not\s+available|busy|unavailable)\s+(?:on\s+)?(.+)/i, type: 'unavailable', person: 'self' },
            { regex: /(?:i\s+)?can'?t\s+(?:do|make|play|attend)\s+(?:it\s+)?(?:on\s+)?(.+)/i, type: 'unavailable', person: 'self' },
            
            // Other person available
            { regex: /(\w+)(?:'s| is)?\s+(?:available|free|can attend|can make it|can do it)\s+(?:on\s+)?(.+)/i, type: 'available', person: 'other' },
            { regex: /(\w+)\s+can\s+(?:do|make|play|attend)\s+(?:it\s+)?(?:on\s+)?(.+)/i, type: 'available', person: 'other' },
            
            // Other person unavailable
            { regex: /(\w+)(?:'s| is)?\s+(?:not available|busy|unavailable|can't attend)\s+(?:on\s+)?(.+)/i, type: 'unavailable', person: 'other' },
            { regex: /(\w+)\s+can'?t\s+(?:do|make|play|attend)\s+(?:it\s+)?(?:on\s+)?(.+)/i, type: 'unavailable', person: 'other' }
        ];
        
        // Check each pattern
        for (const pattern of availabilityPatterns) {
            const match = content.match(pattern.regex);
            if (match) {
                if (pattern.person === 'self') {
                    this.processDateTimeText(message, match[1], pattern.type, null);
                } else {
                    const name = match[1];
                    const dateTimeText = match[2];
                    this.processDateTimeText(message, dateTimeText, pattern.type, name);
                }
                return;
            }
        }
        
        // Additional patterns for time ranges
        const rangePatterns = [
            // Self time range
            { regex: /(?:i'?m\s+)?(?:available|free)\s+(?:from|between)\s+(.+?)\s+(?:to|until|and)\s+(.+)/i, type: 'available', person: 'self' },
            { regex: /(?:i'?m\s+)?(?:busy|unavailable)\s+(?:from|between)\s+(.+?)\s+(?:to|until|and)\s+(.+)/i, type: 'unavailable', person: 'self' },
            
            // Other person time range
            { regex: /(\w+)(?:'s| is)?\s+(?:available|free)\s+(?:from|between)\s+(.+?)\s+(?:to|until|and)\s+(.+)/i, type: 'available', person: 'other' },
            { regex: /(\w+)(?:'s| is)?\s+(?:busy|unavailable)\s+(?:from|between)\s+(.+?)\s+(?:to|until|and)\s+(.+)/i, type: 'unavailable', person: 'other' }
        ];
        
        // Check each range pattern
        for (const pattern of rangePatterns) {
            const match = content.match(pattern.regex);
            if (match) {
                if (pattern.person === 'self') {
                    const startTimeText = match[1];
                    const endTimeText = match[2];
                    this.processTimeRange(message, startTimeText, endTimeText, pattern.type, null);
                } else {
                    const name = match[1];
                    const startTimeText = match[2];
                    const endTimeText = match[3];
                    this.processTimeRange(message, startTimeText, endTimeText, pattern.type, name);
                }
                return;
            }
        }
    }
    
    processDateTimeText(message, dateTimeText, type, name) {
        const guildId = message.guild?.id;
        if (!guildId) return;
        
        const isOtherPerson = name !== null;
        
        const parsedDates = chrono.parse(dateTimeText);
        
        parsedDates.forEach(parsed => {
            const date = parsed.start.date();
            const dateTime = DateTime.fromJSDate(date);
            
            // Handle both specific times and entire day availability
            if (parsed.start.get('hour') !== undefined) {
                // Specific time
                const timeKey = dateTime.toFormat('yyyy-MM-dd HH:mm');
                
                if (isOtherPerson) {
                    this.handleMentionedPerson(guildId, name, dateTime, type, [dateTime.hour]);
                } else {
                    this.addTimeSlot(guildId, timeKey, message.author.id, type);
                    this.updateUserAvailability(guildId, message.author.id, dateTime, type);
                }
            } else {
                // Entire day - add availability for all hours
                const dayStart = dateTime.startOf('day');
                const hours = [];
                
                for (let hour = 8; hour <= 23; hour++) {
                    const timeSlot = dayStart.plus({ hours: hour });
                    const timeKey = timeSlot.toFormat('yyyy-MM-dd HH:mm');
                    hours.push(hour);
                    
                    if (!isOtherPerson) {
                        this.addTimeSlot(guildId, timeKey, message.author.id, type);
                        this.updateUserAvailability(guildId, message.author.id, timeSlot, type);
                    }
                }
                
                if (isOtherPerson) {
                    this.handleMentionedPerson(guildId, name, dayStart, type, hours);
                }
            }
            
            // Store event data
            const guildEvents = this.events.get(guildId);
            guildEvents.set(message.id, {
                messageId: message.id,
                author: message.author.username,
                userId: message.author.id,
                date: date,
                text: message.content,
                type: type,
                channelId: message.channel.id,
                mentionedName: name
            });
        });
    }
    
    processTimeRange(message, startTimeText, endTimeText, type, name) {
        const guildId = message.guild?.id;
        if (!guildId) return;
        
        const isOtherPerson = name !== null;
        
        // Parse start and end times
        const parsedStartDates = chrono.parse(startTimeText);
        const parsedEndDates = chrono.parse(endTimeText);
        
        if (parsedStartDates.length === 0 || parsedEndDates.length === 0) {
            return;
        }
        
        const startDate = parsedStartDates[0].start.date();
        const endDate = parsedEndDates[0].start.date();
        
        const startDateTime = DateTime.fromJSDate(startDate);
        const endDateTime = DateTime.fromJSDate(endDate);
        
        // Make sure we have hours
        let startHour = startDateTime.hour;
        let endHour = endDateTime.hour;
        
        // Default hours if not specified
        if (parsedStartDates[0].start.get('hour') === undefined) {
            startHour = 8; // Default to 8 AM
        }
        
        if (parsedEndDates[0].start.get('hour') === undefined) {
            endHour = 23; // Default to 11 PM
        }
        
        // Calculate hours in the range
        const hours = [];
        for (let hour = startHour; hour <= endHour; hour++) {
            hours.push(hour);
        }
        
        // Same day assumption
        const baseDate = startDateTime.startOf('day');
        
        if (isOtherPerson) {
            this.handleMentionedPerson(guildId, name, baseDate, type, hours);
        } else {
            // Add each hour in the range
            for (let hour of hours) {
                const timeSlot = baseDate.plus({ hours: hour });
                const timeKey = timeSlot.toFormat('yyyy-MM-dd HH:mm');
                this.addTimeSlot(guildId, timeKey, message.author.id, type);
                this.updateUserAvailability(guildId, message.author.id, timeSlot, type);
            }
        }
        
        // Store event data
        const guildEvents = this.events.get(guildId);
        guildEvents.set(message.id, {
            messageId: message.id,
            author: message.author.username,
            userId: message.author.id,
            date: startDate,
            text: message.content,
            type: type,
            channelId: message.channel.id,
            mentionedName: name,
            timeRange: { start: startHour, end: endHour }
        });
    }
    
    handleMentionedPerson(guildId, name, date, status, hours) {
        // This is just a signal to the CalendarService that a non-user person was mentioned
        // The actual handling happens in the CalendarService
        if (global.calendarService) {
            global.calendarService.addMentionedAvailability(guildId, name, date, status, hours);
        }
    }
    
    addTimeSlot(guildId, timeKey, userId, type) {
        const map = type === 'available' ? this.availabilities : this.unavailabilities;
        const guildMap = map.get(guildId);
        
        if (!guildMap.has(timeKey)) {
            guildMap.set(timeKey, new Set());
        }
        guildMap.get(timeKey).add(userId);
    }
    
    removeTimeSlot(guildId, timeKey, userId, type) {
        const map = type === 'available' ? this.availabilities : this.unavailabilities;
        const guildMap = map.get(guildId);
        
        if (guildMap && guildMap.has(timeKey)) {
            guildMap.get(timeKey).delete(userId);
            if (guildMap.get(timeKey).size === 0) {
                guildMap.delete(timeKey);
            }
        }
    }
    
    updateUserAvailability(guildId, userId, dateTime, type) {
        const guildUserMap = this.userAvailability.get(guildId);
        
        if (!guildUserMap.has(userId)) {
            guildUserMap.set(userId, new Map());
        }
        
        const userMap = guildUserMap.get(userId);
        const dateKey = dateTime.toFormat('yyyy-MM-dd');
        
        if (!userMap.has(dateKey)) {
            userMap.set(dateKey, { available: new Set(), unavailable: new Set() });
        }
        
        const dayData = userMap.get(dateKey);
        const hour = dateTime.hour;
        
        if (type === 'available') {
            dayData.available.add(hour);
            dayData.unavailable.delete(hour);
        } else {
            dayData.unavailable.add(hour);
            dayData.available.delete(hour);
        }
    }
    
    removeAvailability(message) {
        const guildId = message.guild?.id;
        if (!guildId) return;
        
        const guildEvents = this.events.get(guildId);
        if (!guildEvents) return;
        
        const event = guildEvents.get(message.id);
        if (event) {
            const dateTime = DateTime.fromJSDate(event.date);
            
            if (event.mentionedName) {
                // Notify CalendarService about removing a mentioned person
                if (global.calendarService) {
                    // TODO: implement removal of mentioned persons
                }
            } else {
                // Remove from time-based maps
                if (event.timeRange) {
                    // Handle time range removal
                    const baseDate = dateTime.startOf('day');
                    for (let hour = event.timeRange.start; hour <= event.timeRange.end; hour++) {
                        const timeSlot = baseDate.plus({ hours: hour });
                        const timeKey = timeSlot.toFormat('yyyy-MM-dd HH:mm');
                        this.removeTimeSlot(guildId, timeKey, event.userId, event.type);
                    }
                } else {
                    // Handle single time removal
                    const timeKey = dateTime.toFormat('yyyy-MM-dd HH:mm');
                    this.removeTimeSlot(guildId, timeKey, event.userId, event.type);
                }
                
                // Remove from user availability map
                const guildUserMap = this.userAvailability.get(guildId);
                if (guildUserMap && guildUserMap.has(event.userId)) {
                    const userMap = guildUserMap.get(event.userId);
                    const dateKey = dateTime.toFormat('yyyy-MM-dd');
                    
                    if (userMap.has(dateKey)) {
                        const dayData = userMap.get(dateKey);
                        
                        if (event.timeRange) {
                            // Remove time range
                            for (let hour = event.timeRange.start; hour <= event.timeRange.end; hour++) {
                                if (event.type === 'available') {
                                    dayData.available.delete(hour);
                                } else {
                                    dayData.unavailable.delete(hour);
                                }
                            }
                        } else {
                            // Remove single time
                            const hour = dateTime.hour;
                            if (event.type === 'available') {
                                dayData.available.delete(hour);
                            } else {
                                dayData.unavailable.delete(hour);
                            }
                        }
                        
                        // Clean up empty entries
                        if (dayData.available.size === 0 && dayData.unavailable.size === 0) {
                            userMap.delete(dateKey);
                        }
                    }
                    
                    if (userMap.size === 0) {
                        guildUserMap.delete(event.userId);
                    }
                }
            }
            
            guildEvents.delete(message.id);
        }
    }
    
    getAvailableUsers(guildId, timeKey) {
        const guildAvail = this.availabilities.get(guildId);
        return guildAvail ? (guildAvail.get(timeKey) || new Set()) : new Set();
    }
    
    getUnavailableUsers(guildId, timeKey) {
        const guildUnavail = this.unavailabilities.get(guildId);
        return guildUnavail ? (guildUnavail.get(timeKey) || new Set()) : new Set();
    }
    
    getAllAvailableUsers(guildId, dateStr) {
        const result = new Set();
        const guildAvail = this.availabilities.get(guildId);
        
        if (guildAvail) {
            for (const [timeKey, users] of guildAvail.entries()) {
                if (timeKey.startsWith(dateStr)) {
                    for (const userId of users) {
                        result.add(userId);
                    }
                }
            }
        }
        
        return result;
    }
    
    getAllUnavailableUsers(guildId, dateStr) {
        const result = new Set();
        const guildUnavail = this.unavailabilities.get(guildId);
        
        if (guildUnavail) {
            for (const [timeKey, users] of guildUnavail.entries()) {
                if (timeKey.startsWith(dateStr)) {
                    for (const userId of users) {
                        result.add(userId);
                    }
                }
            }
        }
        
        return result;
    }
    
    getUserAvailability(guildId, userId, date) {
        const guildUserMap = this.userAvailability.get(guildId);
        if (!guildUserMap) return { available: new Set(), unavailable: new Set() };
        
        const userMap = guildUserMap.get(userId);
        if (!userMap) return { available: new Set(), unavailable: new Set() };
        
        const dateKey = date.toFormat('yyyy-MM-dd');
        
        if (userMap.has(dateKey)) {
            return userMap.get(dateKey);
        }
        
        return { available: new Set(), unavailable: new Set() };
    }
    
    setUserAvailability(guildId, userId, date, availableHours, unavailableHours) {
        this.initializeGuildData(guildId);
        
        const guildUserMap = this.userAvailability.get(guildId);
        
        if (!guildUserMap.has(userId)) {
            guildUserMap.set(userId, new Map());
        }
        
        const userMap = guildUserMap.get(userId);
        const dateKey = date.toFormat('yyyy-MM-dd');
        
        userMap.set(dateKey, {
            available: new Set(availableHours),
            unavailable: new Set(unavailableHours)
        });
        
        // Update time-based maps
        const dayStart = date.startOf('day');
        
        for (let hour = 0; hour <= 23; hour++) {
            const timeSlot = dayStart.plus({ hours: hour });
            const timeKey = timeSlot.toFormat('yyyy-MM-dd HH:mm');
            
            if (availableHours.includes(hour)) {
                this.addTimeSlot(guildId, timeKey, userId, 'available');
                this.removeTimeSlot(guildId, timeKey, userId, 'unavailable');
            } else if (unavailableHours.includes(hour)) {
                this.addTimeSlot(guildId, timeKey, userId, 'unavailable');
                this.removeTimeSlot(guildId, timeKey, userId, 'available');
            } else {
                this.removeTimeSlot(guildId, timeKey, userId, 'available');
                this.removeTimeSlot(guildId, timeKey, userId, 'unavailable');
            }
        }
    }
    
    getDayAvailableCount(guildId, dateStr) {
        const guildAvail = this.availabilities.get(guildId);
        if (!guildAvail) return 0;
        
        let count = 0;
        for (const [timeKey, users] of guildAvail) {
            if (timeKey.startsWith(dateStr)) {
                count += users.size;
            }
        }
        return count;
    }
    
    getDayUnavailableCount(guildId, dateStr) {
        const guildUnavail = this.unavailabilities.get(guildId);
        if (!guildUnavail) return 0;
        
        let count = 0;
        for (const [timeKey, users] of guildUnavail) {
            if (timeKey.startsWith(dateStr)) {
                count += users.size;
            }
        }
        return count;
    }
    
    clearChannelData(channelId) {
        // Clear events for this channel across all guilds
        for (const [guildId, guildEvents] of this.events) {
            for (const [messageId, event] of guildEvents) {
                if (event.channelId === channelId) {
                    this.removeAvailability({ id: messageId, guild: { id: guildId } });
                }
            }
        }
    }
}

module.exports = AvailabilityService;