// utils/healthcheck.js
const { Client, GatewayIntentBits } = require('discord.js');

module.exports = async function healthcheck() {
    return new Promise((resolve, reject) => {
        const client = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        const timeout = setTimeout(() => {
            client.destroy();
            reject(new Error('Healthcheck timeout'));
        }, 15000);

        client.once('ready', () => {
            clearTimeout(timeout);
            client.destroy();
            resolve();
        });

        client.on('error', (error) => {
            clearTimeout(timeout);
            client.destroy();
            reject(error);
        });

        client.login(process.env.DISCORD_TOKEN).catch((error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

// Run if called directly
if (require.main === module) {
    module.exports()
        .then(() => {
            console.log('Bot is healthy');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Bot is unhealthy:', error);
            process.exit(1);
        });
}