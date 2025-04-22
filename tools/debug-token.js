// Minimal test bot to verify token
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('No token found!');
    console.error('Make sure you have a .env file with DISCORD_TOKEN=your_token_here');
    process.exit(1);
}

console.log('Token found, attempting to login...');
console.log(`Token length: ${token.length}`);

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds] 
});

client.once('ready', () => {
    console.log(`✅ Successfully logged in as ${client.user.tag}`);
    console.log('Bot is working! You can now run the full calendar bot.');
    client.destroy();
});

client.on('error', (error) => {
    console.error('❌ Error:', error);
});

client.login(token).catch(error => {
    console.error('❌ Login failed:', error.message);
    if (error.code === 'TokenInvalid') {
        console.error('\nThe token is invalid. Please check:');
        console.error('1. You copied the entire token from Discord Developer Portal');
        console.error('2. The token has no spaces before or after');
        console.error('3. You generated the token recently (tokens can expire)');
        console.error('4. You\'re using the BOT token, not the client ID or secret');
    }
});