const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');

// Get the bot token from environment variable
const botToken = process.env.TOKEN;

if (!botToken) {
  console.error('Bot token not configured. Please set the TOKEN environment variable.');
  process.exit(1);
}

const bot = new Telegraf(botToken);

// Introduction message on /start
bot.start((ctx) => {
  ctx.reply(`
🎥 *Video Downloader Bot* 🎥
Powered by @KaIi_Linux_BOT

Hi! I can download videos from Instagram and YouTube. Just send me a video link, and I’ll get it for you. 🚀

📌 Supported platforms:
- Instagram (public videos)
- YouTube (public videos)

⚠️ Note: Videos must be under 50 MB due to Telegram limits.
  `, { parse_mode: 'Markdown' });
});

// Function to scrape Instagram video URL
async function getInstagramVideoUrl(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(response.data);
    const videoUrl = $('meta[property="og:video"]').attr('content');
    if (!videoUrl) throw new Error('Could not find Instagram video URL.');
    return videoUrl;
  } catch (error) {
    throw new Error('Failed to scrape Instagram video: ' + error.message);
  }
}

// Function to download YouTube video
async function downloadYouTubeVideo(url) {
  try {
    const info = await ytdl.getInfo(url);
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestvideo', filter: 'videoandaudio' });
    if (!format) throw new Error('No suitable YouTube format found.');

    const filePath = path.join(__dirname, `video-${Date.now()}.mp4`);
    const videoStream = ytdl(url, { format });
    const fileStream = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      videoStream.pipe(fileStream);
      fileStream.on('finish', () => resolve(filePath));
      fileStream.on('error', (err) => reject(err));
    });
  } catch (error) {
    throw new Error('Failed to download YouTube video: ' + error.message);
  }
}

// Handle incoming messages (links)
bot.on('text', async (ctx) => {
  const url = ctx.message.text.trim();
  let videoPath = null;

  try {
    // Check if the link is Instagram or YouTube
    if (url.includes('instagram.com')) {
      ctx.reply('🔍 Detecting Instagram video...');
      const videoUrl = await getInstagramVideoUrl(url);

      // Download the video
      ctx.reply('⏳ Downloading Instagram video...');
      const response = await axios.get(videoUrl, { responseType: 'stream' });
      videoPath = path.join(__dirname, `insta-video-${Date.now()}.mp4`);
      const fileStream = fs.createWriteStream(videoPath);
      response.data.pipe(fileStream);

      await new Promise((resolve) => fileStream.on('finish', resolve));
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      ctx.reply('🔍 Detecting YouTube video...');
      ctx.reply('⏳ Downloading YouTube video...');
      videoPath = await downloadYouTubeVideo(url);
    } else {
      ctx.reply('❌ Please send a valid Instagram or YouTube video link.');
      return;
    }

    // Check file size (Telegram limit: 50 MB)
    const stats = fs.statSync(videoPath);
    if (stats.size > 50 * 1024 * 1024) {
      fs.unlinkSync(videoPath);
      ctx.reply('❌ Video is too large (>50 MB). Telegram limits file uploads to 50 MB.');
      return;
    }

    // Send the video to the user
    ctx.reply('🚀 Sending video...');
    await ctx.replyWithVideo({ source: videoPath });

    // Clean up
    fs.unlinkSync(videoPath);
  } catch (error) {
    if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    ctx.reply('❌ Error: ' + error.message);
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
