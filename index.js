const { Telegraf } = require('telegraf');
const axios = require('axios');
const { MongoClient } = require('mongodb');

// Get the bot token and MongoDB URI from environment variables
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

// API endpoint for image generation
const API_URL = 'https://ar-api-08uk.onrender.com/turbo';

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
  ctx.reply('Send me a prompt (e.g., "red car BMW"), and I’ll generate AI images for you! 🎨');
});

// Handle incoming text messages (non-blocking)
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const userPrompt = ctx.message.text.trim();

  // Store chat ID
  await storeChatId(chatId);

  // Send "Generating..." message immediately
  ctx.reply('Generating images... 🎨').catch((err) => console.error('Failed to send generating message:', err));

  // Process the API request in a non-blocking way
  setImmediate(async () => {
    try {
      // Make the API request
      const response = await axios.get(API_URL, {
        params: { prompt: userPrompt },
        timeout: 30000 // 30-second timeout for image generation
      });

      // Extract the images from the API response
      const data = response.data;
      const imageUrls = data.images;

      if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
        throw new Error('No images returned from the API.');
      }

      // Send each image as a photo
      for (const url of imageUrls) {
        await ctx.replyWithPhoto(url);
      }

      // Optionally send the "join" link from the API response
      if (data.join) {
        await ctx.reply(`Join the community: ${data.join}`);
      }
    } catch (error) {
      console.error('Error:', error.message);
      await ctx.reply('❌ Sorry, I couldn’t generate images. Try a different prompt or check back later.');
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
