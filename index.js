const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Get the bot token from environment variable
const botToken = process.env.TOKEN;

if (!botToken) {
  console.error('Bot token not configured. Please set the TOKEN environment variable.');
  process.exit(1);
}

const bot = new Telegraf(botToken);

// Instagram downloader API (using a public service)
const INSTAGRAM_DOWNLOADER_API = 'https://sssinstagram.com/api/convert';

// Temporary directory for storing videos
const TEMP_DIR = path.join(__dirname, 'temp');

// Ensure the temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Introduction message on /start
bot.start((ctx) => {
  ctx.reply('Welcome to the Instagram Video Downloader Bot! 🎥\nSend me an Instagram video URL, and I’ll download and send the video to you.');
});

// Function to validate Instagram URL
function isValidInstagramUrl(url) {
  const instagramRegex = /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|tv|stories)\/[A-Za-z0-9_-]+/;
  return instagramRegex.test(url);
}

// Function to download Instagram video
async function downloadInstagramVideo(url) {
  try {
    // Make request to the Instagram downloader API
    const response = await axios.get(INSTAGRAM_DOWNLOADER_API, {
      params: { url },
      timeout: 15000 // 15-second timeout
    });

    const data = response.data;
    if (!data || !data[0] || !data[0].url) {
      throw new Error('No downloadable video found.');
    }

    // Get the first downloadable video URL
    const videoUrl = data[0].url;

    // Download the video
    const videoResponse = await axios({
      url: videoUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000 // 30-second timeout for download
    });

    // Generate a unique filename
    const fileName = `video_${Date.now()}.mp4`;
    const filePath = path.join(TEMP_DIR, fileName);

    // Save the video to the temp directory
    const writer = fs.createWriteStream(filePath);
    videoResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', (err) => reject(err));
    });
  } catch (error) {
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

// Handle incoming text messages (Instagram URLs)
bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text.trim();

  // Validate the URL
  if (!isValidInstagramUrl(userMessage)) {
    return ctx.reply('Please send a valid Instagram video URL (e.g., https://www.instagram.com/reel/abc123/).');
  }

  // Send "Processing..." message
  ctx.reply('Processing your request... ⏳').catch((err) => console.error('Failed to send processing message:', err));

  // Process the download in a non-blocking way
  setImmediate(async () => {
    try {
      // Download the video
      const videoPath = await downloadInstagramVideo(userMessage);

      // Send the video to the user
      await ctx.replyWithVideo({ source: videoPath }, { caption: 'Here’s your Instagram video! 🎥' });

      // Clean up: Delete the temporary file
      fs.unlink(videoPath, (err) => {
        if (err) console.error('Failed to delete temporary file:', err);
      });
    } catch (error) {
      console.error('Error:', error.message);
      await ctx.reply('❌ Sorry, I couldn’t download the video. Please try again later or check the URL.');
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
