// Check bot permissions for a specific channel
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ] 
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    // Check permissions for specific channel
    const channelId = '1364057088371851286'; // Replace with your channel ID
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            console.log('Channel not found');
            return;
        }
        
        const permissions = channel.permissionsFor(client.user);
        console.log('\nBot permissions for channel:');
        console.log('View Channel:', permissions.has(PermissionsBitField.Flags.ViewChannel));
        console.log('Send Messages:', permissions.has(PermissionsBitField.Flags.SendMessages));
        console.log('Read Message History:', permissions.has(PermissionsBitField.Flags.ReadMessageHistory));
        console.log('Embed Links:', permissions.has(PermissionsBitField.Flags.EmbedLinks));
        
        // Check if bot can access the channel
        const canAccess = permissions.has([
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory
        ]);
        
        console.log('\nBot can access channel:', canAccess);
        
        if (!canAccess) {
            console.log('\nMissing permissions - please check:');
            console.log('1. Bot role permissions in server settings');
            console.log('2. Channel-specific permissions');
            console.log('3. Category permissions if channel is in a category');
        }
    } catch (error) {
        console.error('Error checking permissions:', error.message);
    }
    
    client.destroy();
});

client.login(process.env.DISCORD_TOKEN);