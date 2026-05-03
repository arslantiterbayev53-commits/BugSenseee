// index.js — entry point

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Validate required env vars before loading anything else
const REQUIRED_ENV = ['TELEGRAM_TOKEN', 'GROQ_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const bot = require('./bot');

console.log('🐛 BugSense starting...');

bot.launch()
  .then(() => console.log('✅ BugSense is running!'))
  .catch((err) => {
    console.error('❌ Failed to start bot:', err.message);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));