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

// Function to normalize URLs (remove query params like ?igsh=)
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname;
  } catch (error) {
    return url;
  }
}

// Function to scrape Instagram video URL with fallback
async function getInstagramVideoUrl(url) {
  try {
    // Normalize the URL
    url = normalizeUrl(url);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive'
      }
    });

    const $ = cheerio.load(response.data);

    // Try the og:video meta tag first
    let videoUrl = $('meta[property="og:video"]').attr('content');
    if (videoUrl) return videoUrl;

    // Fallback: Look for the video URL in the page's JSON data
    const scriptTags = $('script[type="application/ld+json"]').html();
    if (scriptTags) {
      const jsonData = JSON.parse(scriptTags);
      if (jsonData && jsonData.video && jsonData.video.contentUrl) {
        return jsonData.video.contentUrl;
      }
    }

    // Another fallback: Check for window._sharedData (older Instagram method)
    const sharedDataScript = $('script').filter((i, el) => $(el).html().includes('window._sharedData')).html();
    if (sharedDataScript) {
      const sharedData = sharedDataScript.match(/window\._sharedData\s*=\s*({.+?});/);
      if (sharedData && sharedData[1]) {
        const parsedData = JSON.parse(sharedData[1]);
        const media = parsedData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
        if (media?.video_url) {
          return media.video_url;
        }
      }
    }

    throw new Error('Could not find Instagram video URL in page data.');
  } catch (error) {
    throw new Error('Failed to scrape Instagram video: ' + error.message);
  }
}

// Function to download YouTube video with better format selection
async function downloadYouTubeVideo(url) {
  try {
    const info = await ytdl.getInfo(url);
    // Filter formats: prioritize smaller files (Telegram limit: 50 MB)
    const format = ytdl.chooseFormat(info.formats, { 
      quality: 'lowestvideo', // Prioritize lower quality to stay under 50 MB
      filter: (format) => format.container === 'mp4' && format.hasVideo && format.hasAudio
    });

    if (!format) throw new Error('No suitable YouTube format found (must be MP4 with video and audio).');

    const filePath = path.join(__dirname, `youtube-video-${Date.now()}.mp4`);
    const videoStream = ytdl(url, { format });
    const fileStream = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      videoStream.pipe(fileStream);
      fileStream.on('finish', () => {
        // Check file size before resolving
        const stats = fs.statSync(filePath);
        if (stats.size > 50 * 1024 * 1024) {
          fs.unlinkSync(filePath);
          reject(new Error('YouTube video is too large (>50 MB). Try a shorter video.'));
        } else {
          resolve(filePath);
        }
      });
      fileStream.on('error', (err) => reject(err));
    });
  } catch (error) {
    throw new Error('Failed to download YouTube video: ' + error.message);
  }
}

// Function to download a video from a direct URL (used for Instagram)
async function downloadVideoFromUrl(videoUrl, fileName) {
  const filePath = path.join(__dirname, fileName);
  const response = await axios.get(videoUrl, { responseType: 'stream' });
  
  // Get file size from headers if available
  const contentLength = response.headers['content-length'];
  if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
    throw new Error('Instagram video is too large (>50 MB).');
  }

  const fileStream = fs.createWriteStream(filePath);
  response.data.pipe(fileStream);

  return new Promise((resolve, reject) => {
    fileStream.on('finish', () => {
      // Double-check file size
      const stats = fs.statSync(filePath);
      if (stats.size > 50 * 1024 * 1024) {
        fs.unlinkSync(filePath);
        reject(new Error('Instagram video is too large (>50 MB).'));
      } else {
        resolve(filePath);
      }
    });
    fileStream.on('error', (err) => reject(err));
  });
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
      videoPath = await downloadVideoFromUrl(videoUrl, `insta-video-${Date.now()}.mp4`);
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      ctx.reply('🔍 Detecting YouTube video...');
      ctx.reply('⏳ Downloading YouTube video...');
      videoPath = await downloadYouTubeVideo(url);
    } else {
      ctx.reply('❌ Please send a valid Instagram or YouTube video link.');
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
