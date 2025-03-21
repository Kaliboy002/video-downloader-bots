const { Telegraf } = require('telegraf');
const axios = require('axios');
const { MongoClient } = require('mongodb');

// Get the bot token from environment variable
const botToken = process.env.TOKEN;
const mongoUri = process.env.MONGO_URI;

if (!botToken) {
  console.error('Bot token not configured. Please set the TOKEN environment variable.');
  process.exit(1);
}

if (!mongoUri) {
  console.error('MongoDB URI not configured. Please set the MONGO_URI environment variable.');
  process.exit(1);
}

const bot = new Telegraf(botToken);

// API endpoint
const API_URL = 'https://ar-api-08uk.onrender.com/ava';

// MongoDB setup
let db;
async function connectToMongo() {
  try {
    const client = new MongoClient(mongoUri, { useUnifiedTopology: true });
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db('shah'); // Database name from your URI
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

// Store chat ID in MongoDB
async function storeChatId(chatId) {
  try {
    const collection = db.collection('chat_ids');
    await collection.updateOne(
      { chatId },
      { $set: { chatId, lastInteraction: new Date() } },
      { upsert: true }
    );
    console.log(`Stored chat ID: ${chatId}`);
  } catch (error) {
    console.error('Failed to store chat ID:', error);
  }
}

// Connect to MongoDB when the bot starts
connectToMongo();

// Introduction message on /start
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  await storeChatId(chatId); // Store chat ID
  ctx.reply('Ask your question, and I’ll get you an answer! 🧠');
});

// Handle incoming text messages (non-blocking)
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const userQuery = ctx.message.text.trim();

  // Store chat ID
  await storeChatId(chatId);

  // Send "Thinking..." message immediately
  ctx.reply('Thinking... 🤔').catch((err) => console.error('Failed to send thinking message:', err));

  // Process the API request in a non-blocking way
  setImmediate(async () => {
    try {
      // Make the API request
      const response = await axios.get(API_URL, {
        params: { q: userQuery },
        timeout: 10000 // 10-second timeout to avoid hanging
      });

      // Extract the response from the API
      const data = response.data;
      if (data.status !== 200 || data.successful !== 'success') {
        throw new Error('API request failed.');
      }

      const answer = data.response;
      if (!answer) {
        throw new Error('No response from the API.');
      }

      // Send the response to the user
      await ctx.reply(answer);
    } catch (error) {
      console.error('Error:', error.message);
      await ctx.reply('❌ Sorry, I couldn’t get an answer. Try again later.');
    }
  });
});

// Export the handler for Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else {
      res.status(200).send('Bot is running.');
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};
