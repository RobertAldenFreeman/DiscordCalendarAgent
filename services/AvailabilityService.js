// services/AvailabilityService.js
const { DateTime } = require('luxon');
const chrono = require('chrono-node');
const logger = require('../utils/logger');

class AvailabilityService {
    constructor() {
        this.availabilities = new Map(); // timeKey -> Set of userIds
        this.unavailabilities = new Map(); // timeKey -> Set of userIds
        this.events = new Map(); // messageId -> event data
        this.userAvailability = new Map(); // userId -> date -> { available: Set<hour>, unavailable: Set<hour> }
    }
    
    extractAvailability(message) {
        const content = message.content.toLowerCase();
        
        // Patterns for availability
        const availablePatterns = [
            /(?:i'?m\s+)?(?:available|free)\s+(?:on\s+)?(.+)/i,
            /(?:i\s+)?can\s+(?:do|make|play)\s+(?:it\s+)?(?:on\s+)?(.+)/i
        ];
        
        const unavailablePatterns = [
            /(?:i'?m\s+)?(?:not\s+available|busy|unavailable)\s+(?:on\s+)?(.+)/i,
            /(?:i\s+)?can'?t\s+(?:do|make|play)\s+(?:it\s+)?(?:on\s+)?(.+)/i
        ];
        
        let found = false;
        
        // Check for available times
        for (const pattern of availablePatterns) {
            const match = content.match(pattern);
            if (match) {
                const dateTimeText = match[1];
                this.processDateTimeText(message, dateTimeText, 'available');
                found = true;
                break;
            }
        }
        
        // Check for unavailable times
        if (!found) {
            for (const pattern of unavailablePatterns) {
                const match = content.match(pattern);
                if (match) {
                    const dateTimeText = match[1];
                    this.processDateTimeText(message, dateTimeText, 'unavailable');
                    break;
                }
            }
        }
    }
    
    processDateTimeText(message, dateTimeText, type) {
        const parsedDates = chrono.parse(dateTimeText);
        
        parsedDates.forEach(parsed => {
            const date = parsed.start.date();
            const dateTime = DateTime.fromJSDate(date);
            
            // Handle both specific times and entire day availability
            if (parsed.start.get('hour') !== undefined) {
                // Specific time
                const timeKey = dateTime.toFormat('yyyy-MM-dd HH:mm');
                this.addTimeSlot(timeKey, message.author.id, type);
                
                // Also update hourly availability
                this.updateUserAvailability(message.author.id, dateTime, type);
            } else {
                // Entire day - add availability for all hours
                const dayStart = dateTime.startOf('day');
                for (let hour = 8; hour <= 23; hour++) {
                    const timeSlot = dayStart.plus({ hours: hour });
                    const timeKey = timeSlot.toFormat('yyyy-MM-dd HH:mm');
                    this.addTimeSlot(timeKey, message.author.id, type);
                    this.updateUserAvailability(message.author.id, timeSlot, type);
                }
            }
            
            // Store event data
            this.events.set(message.id, {
                messageId: message.id,
                author: message.author.username,
                userId: message.author.id,
                date: date,
                text: message.content,
                type: type,
                channelId: message.channel.id
            });
        });
    }
    
    addTimeSlot(timeKey, userId, type) {
        const map = type === 'available' ? this.availabilities : this.unavailabilities;
        if (!map.has(timeKey)) {
            map.set(timeKey, new Set());
        }
        map.get(timeKey).add(userId);
    }
    
    removeTimeSlot(timeKey, userId, type) {
        const map = type === 'available' ? this.availabilities : this.unavailabilities;
        if (map.has(timeKey)) {
            map.get(timeKey).delete(userId);
            if (map.get(timeKey).size === 0) {
                map.delete(timeKey);
            }
        }
    }
    
    updateUserAvailability(userId, dateTime, type) {
        if (!this.userAvailability.has(userId)) {
            this.userAvailability.set(userId, new Map());
        }
        
        const userMap = this.userAvailability.get(userId);
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
        const event = this.events.get(message.id);
        if (event) {
            const dateTime = DateTime.fromJSDate(event.date);
            
            // Remove from time-based maps
            const timeKey = dateTime.toFormat('yyyy-MM-dd HH:mm');
            this.removeTimeSlot(timeKey, event.userId, event.type);
            
            // Remove from user availability map
            if (this.userAvailability.has(event.userId)) {
                const userMap = this.userAvailability.get(event.userId);
                const dateKey = dateTime.toFormat('yyyy-MM-dd');
                
                if (userMap.has(dateKey)) {
                    const dayData = userMap.get(dateKey);
                    const hour = dateTime.hour;
                    
                    if (event.type === 'available') {
                        dayData.available.delete(hour);
                    } else {
                        dayData.unavailable.delete(hour);
                    }
                    
                    // Clean up empty entries
                    if (dayData.available.size === 0 && dayData.unavailable.size === 0) {
                        userMap.delete(dateKey);
                    }
                }
                
                if (userMap.size === 0) {
                    this.userAvailability.delete(event.userId);
                }
            }
            
            this.events.delete(message.id);
        }
    }
    
    getAvailableUsers(timeKey) {
        return this.availabilities.get(timeKey) || new Set();
    }
    
    getUnavailableUsers(timeKey) {
        return this.unavailabilities.get(timeKey) || new Set();
    }
    
    getUserAvailability(userId, date) {
        const userMap = this.userAvailability.get(userId);
        const dateKey = date.toFormat('yyyy-MM-dd');
        
        if (userMap && userMap.has(dateKey)) {
            return userMap.get(dateKey);
        }
        
        return { available: new Set(), unavailable: new Set() };
    }
    
    setUserAvailability(userId, date, availableHours, unavailableHours) {
        if (!this.userAvailability.has(userId)) {
            this.userAvailability.set(userId, new Map());
        }
        
        const userMap = this.userAvailability.get(userId);
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
                this.addTimeSlot(timeKey, userId, 'available');
                this.removeTimeSlot(timeKey, userId, 'unavailable');
            } else if (unavailableHours.includes(hour)) {
                this.addTimeSlot(timeKey, userId, 'unavailable');
                this.removeTimeSlot(timeKey, userId, 'available');
            } else {
                this.removeTimeSlot(timeKey, userId, 'available');
                this.removeTimeSlot(timeKey, userId, 'unavailable');
            }
        }
    }
    
    getDayAvailableCount(dateStr) {
        let count = 0;
        for (const [timeKey, users] of this.availabilities) {
            if (timeKey.startsWith(dateStr)) {
                count += users.size;
            }
        }
        return count;
    }
    
    getDayUnavailableCount(dateStr) {
        let count = 0;
        for (const [timeKey, users] of this.unavailabilities) {
            if (timeKey.startsWith(dateStr)) {
                count += users.size;
            }
        }
        return count;
    }
    
    clearChannelData(channelId) {
        // Clear events for this channel
        for (const [messageId, event] of this.events.entries()) {
            if (event.channelId === channelId) {
                this.removeAvailability({ id: messageId });
            }
        }
    }
}

module.exports = AvailabilityService;