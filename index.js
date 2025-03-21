const { Telegraf } = require('telegraf');
const axios = require('axios');

// Get the bot token from environment variable
const botToken = process.env.TOKEN;

if (!botToken) {
  console.error('Bot token not configured. Please set the TOKEN environment variable.');
  process.exit(1);
}

const bot = new Telegraf(botToken);

// API endpoint
const API_URL = 'https://ar-api-08uk.onrender.com/ava';

// Introduction message on /start
bot.start((ctx) => {
  ctx.reply('Ask your question, and I’ll get you an answer! 🧠');
});

// Handle incoming text messages
bot.on('text', async (ctx) => {
  const userQuery = ctx.message.text.trim();

  try {
    // Notify user that we're processing
    await ctx.reply('Thinking... 🤔');

    // Make the API request
    const response = await axios.get(API_URL, {
      params: { q: userQuery }
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
