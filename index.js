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

// Instagram downloader API (using snapinsta.app)
const INSTAGRAM_DOWNLOADER_API = 'https://snapinsta.app/api/ajaxSearch';

// Temporary directory for storing videos (use /tmp for Vercel)
const TEMP_DIR = '/tmp/instagram-downloader';

// Ensure the temp directory exists
try {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create temp directory:', error);
  process.exit(1);
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
    // Make request to the Instagram downloader API (snapinsta.app)
    const response = await axios.post(INSTAGRAM_DOWNLOADER_API, new URLSearchParams({ q: url }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 15000 // 15-second timeout
    });

    const data = response.data;
    if (data.status !== 'ok' || !data.data) {
      throw new Error('API returned an error or no data.');
    }

    // snapinsta.app returns HTML in data.data, we need to extract the video URL
    const videoUrlMatch = data.data.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/);
    if (!videoUrlMatch || !videoUrlMatch[1]) {
      throw new Error('No downloadable video URL found in API response.');
    }

    const videoUrl = videoUrlMatch[1];

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

      // Check file size (Telegram has a 50 MB limit for bots)
      const stats = fs.statSync(videoPath);
      if (stats.size > 50 * 1024 * 1024) { // 50 MB in bytes
        throw new Error('Video is too large (max 50 MB for Telegram).');
      }

      // Send the video to the user
      await ctx.replyWithVideo({ source: videoPath }, { caption: 'Here’s your Instagram video! 🎥' });

      // Clean up: Delete the temporary file
      fs.unlink(videoPath, (err) => {
        if (err) console.error('Failed to delete temporary file:', err);
      });
    } catch (error) {
      console.error('Error:', error.message);
      await ctx.reply(`❌ Sorry, I couldn’t download the video. ${error.message}`);
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
