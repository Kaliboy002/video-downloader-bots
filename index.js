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

// AI image generation API (using your provided API)
const IMAGE_GENERATION_API = 'https://ar-api-08uk.onrender.com/turbo';

// Temporary directory for storing images (use /tmp for Vercel)
const TEMP_DIR = '/tmp/image-generator';

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
  ctx.reply('Welcome to the AI Image Generator Bot! 🖼️\nSend me a text prompt (e.g., "red car BMW"), and I’ll generate and send the images to you.');
});

// Function to download an image from a URL
async function downloadImage(imageUrl, index) {
  try {
    // Download the image
    const imageResponse = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000 // 30-second timeout for download
    });

    // Generate a unique filename
    const fileName = `image_${Date.now()}_${index}.png`;
    const filePath = path.join(TEMP_DIR, fileName);

    // Save the image to the temp directory
    const writer = fs.createWriteStream(filePath);
    imageResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', (err) => reject(err));
    });
  } catch (error) {
    throw new Error(`Failed to download image: ${error.message}`);
  }
}

// Function to generate images from a prompt
async function generateImages(prompt) {
  try {
    // Make request to the image generation API
    const response = await axios.get(IMAGE_GENERATION_API, {
      params: { prompt: prompt },
      timeout: 15000 // 15-second timeout
    });

    const data = response.data;
    if (!data.images || !Array.isArray(data.images) || data.images.length === 0) {
      throw new Error('API returned no images.');
    }

    // Download each image
    const imagePaths = [];
    for (let i = 0; i < data.images.length; i++) {
      const imageUrl = data.images[i];
      const imagePath = await downloadImage(imageUrl, i);
      imagePaths.push(imagePath);
    }

    return imagePaths;
  } catch (error) {
    throw new Error(`Failed to generate images: ${error.message}`);
  }
}

// Handle incoming text messages (prompts)
bot.on('text', async (ctx) => {
  const userPrompt = ctx.message.text.trim();

  // Ignore commands like /start
  if (userPrompt.startsWith('/')) {
    return;
  }

  // Send "Processing..." message
  ctx.reply('Processing your request... ⏳').catch((err) => console.error('Failed to send processing message:', err));

  // Process the image generation in a non-blocking way
  setImmediate(async () => {
    try {
      // Generate and download the images
      const imagePaths = await generateImages(userPrompt);

      // Send each image to the user
      for (let i = 0; i < imagePaths.length; i++) {
        const imagePath = imagePaths[i];

        // Check file size (Telegram has a 10 MB limit for photos)
        const stats = fs.statSync(imagePath);
        if (stats.size > 10 * 1024 * 1024) { // 10 MB in bytes
          throw new Error(`Image ${i + 1} is too large (max 10 MB for Telegram photos).`);
        }

        // Send the image
        await ctx.replyWithPhoto(
          { source: imagePath },
          { caption: `Generated image ${i + 1} for prompt: "${userPrompt}" 🖼️` }
        );

        // Clean up: Delete the temporary file
        fs.unlink(imagePath, (err) => {
          if (err) console.error('Failed to delete temporary file:', err);
        });
      }
    } catch (error) {
      console.error('Error:', error.message);
      await ctx.reply(`❌ Sorry, I couldn’t generate the images. ${error.message}`);
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
