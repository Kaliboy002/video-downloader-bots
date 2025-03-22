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

// YouTube downloader API (using your provided API)
const YOUTUBE_DOWNLOADER_API = 'https://ar-api-08uk.onrender.com/pvtyt';

// Temporary directory for storing videos (use /tmp for Vercel)
const TEMP_DIR = '/tmp/youtube-downloader';

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
  ctx.reply('Welcome to the YouTube Video Downloader Bot! 🎥\nSend me a YouTube video URL, and I’ll download and send the video to you.');
});

// Function to validate YouTube URL
function isValidYouTubeUrl(url) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|v\/|.+\?v=)?([^&=%\?]{11})/;
  return youtubeRegex.test(url);
}

// Function to download YouTube video
async function downloadYouTubeVideo(url) {
  try {
    // Make request to the YouTube downloader API
    const response = await axios.get(YOUTUBE_DOWNLOADER_API, {
      params: {
        url: url,
        format: 'mp4' // Request video format
      },
      timeout: 15000 // 15-second timeout
    });

    const data = response.data;
    if (data.status !== 200 || data.successful !== 'success' || !data.data || !data.data.download) {
      throw new Error('API returned an error or no downloadable video found.');
    }

    // Get the downloadable video URL and title
    const videoUrl = data.data.download;
    const videoTitle = data.data.title || 'YouTube Video';

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
      writer.on('finish', () => resolve({ filePath, videoTitle }));
      writer.on('error', (err) => reject(err));
    });
  } catch (error) {
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

// Handle incoming text messages (YouTube URLs)
bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text.trim();

  // Validate the URL
  if (!isValidYouTubeUrl(userMessage)) {
    return ctx.reply('Please send a valid YouTube video URL (e.g., https://youtu.be/abc123).');
  }

  // Send "Processing..." message
  ctx.reply('Processing your request... ⏳').catch((err) => console.error('Failed to send processing message:', err));

  // Process the download in a non-blocking way
  setImmediate(async () => {
    try {
      // Download the video
      const { filePath, videoTitle } = await downloadYouTubeVideo(userMessage);

      // Check file size (Telegram has a 50 MB limit for bots)
      const stats = fs.statSync(filePath);
      if (stats.size > 50 * 1024 * 1024) { // 50 MB in bytes
        throw new Error('Video is too large (max 50 MB for Telegram).');
      }

      // Send the video to the user
      await ctx.replyWithVideo(
        { source: filePath },
        { caption: `Here’s your YouTube video: ${videoTitle} 🎥` }
      );

      // Clean up: Delete the temporary file
      fs.unlink(filePath, (err) => {
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
