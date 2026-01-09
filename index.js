require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const CONFIG = {
  takeScreenshot: process.env.TAKE_SCREENSHOT === 'true',
  maxScrolls: parseInt(process.env.MAX_SCROLLS) || 5,
  scrollDelay: parseInt(process.env.SCROLL_DELAY) || 1000,
  discordCharLimit: 1900, // Safe limit under 2000
  screenshotPath: '/tmp/screenshot.png'
};

// Utility: Split text into Discord-safe chunks
function chunkText(text, limit) {
  const chunks = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    
    // Find a good breaking point (newline or space)
    let breakPoint = remaining.lastIndexOf('\n', limit);
    if (breakPoint === -1) {
      breakPoint = remaining.lastIndexOf(' ', limit);
    }
    if (breakPoint === -1) {
      breakPoint = limit;
    }
    
    chunks.push(remaining.substring(0, breakPoint));
    remaining = remaining.substring(breakPoint).trim();
  }
  
  return chunks;
}

// Utility: Auto-scroll page to load lazy content
async function autoScroll(page, maxScrolls, delay) {
  console.log(`[SCROLL] Starting auto-scroll (max: ${maxScrolls} scrolls)`);
  
  let scrollCount = 0;
  let previousHeight = 0;
  
  while (scrollCount < maxScrolls) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    
    // Stop if page hasn't grown
    if (currentHeight === previousHeight && scrollCount > 0) {
      console.log('[SCROLL] Page stopped growing. Ending scroll.');
      break;
    }
    
    previousHeight = currentHeight;
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(delay);
    
    scrollCount++;
    console.log(`[SCROLL] Scroll ${scrollCount}/${maxScrolls} complete`);
  }
  
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log('[SCROLL] Scrolled back to top');
}

// Main scraping function
async function scrapeAndSend(url) {
  let browser;
  
  try {
    console.log(`[START] Scraping URL: ${url}`);
    
    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport for consistent screenshots
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('[BROWSER] Navigating to URL...');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    console.log('[BROWSER] Page loaded successfully');
    
    // Auto-scroll to load lazy content
    await autoScroll(page, CONFIG.maxScrolls, CONFIG.scrollDelay);
    
    // Extract all visible text
    console.log('[EXTRACT] Extracting page text...');
    const pageText = await page.evaluate(() => {
      return document.body.innerText;
    });
    
    console.log(`[EXTRACT] Extracted ${pageText.length} characters`);
    
    // Take screenshot if enabled
    let screenshotBuffer = null;
    if (CONFIG.takeScreenshot) {
      console.log('[SCREENSHOT] Capturing full page screenshot...');
      screenshotBuffer = await page.screenshot({
        fullPage: true,
        type: 'png'
      });
      console.log('[SCREENSHOT] Screenshot captured');
    }
    
    await browser.close();
    browser = null;
    
    // Send to Discord
    await sendToDiscord(url, pageText, screenshotBuffer);
    
    console.log('[SUCCESS] Scraping and sending completed successfully');
    return { success: true };
    
  } catch (error) {
    console.error('[ERROR] Scraping failed:', error.message);
    
    if (browser) {
      await browser.close();
    }
    
    // Send error notification to Discord
    try {
      await sendErrorToDiscord(url, error.message);
    } catch (discordError) {
      console.error('[ERROR] Failed to send error to Discord:', discordError.message);
    }
    
    throw error;
  }
}

// Send results to Discord webhook
async function sendToDiscord(url, text, screenshotBuffer) {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  
  if (!webhookUrl) {
    throw new Error('DISCORD_WEBHOOK not configured in .env');
  }
  
  console.log('[DISCORD] Preparing payload...');
  
  // Prepare text chunks
  const chunks = chunkText(text, CONFIG.discordCharLimit);
  console.log(`[DISCORD] Split text into ${chunks.length} chunk(s)`);
  
  // Send first message with URL and first chunk
  const firstChunk = chunks[0] || 'No text content found';
  const formData = new FormData();
  
  const payload = {
    content: `**Scraped URL:** ${url}\n**Total Characters:** ${text.length}\n**Chunks:** ${chunks.length}`,
    embeds: [{
      title: '📄 Scraped Content (Part 1)',
      description: `\`\`\`\n${firstChunk}\n\`\`\``,
      color: 0x00ff00,
      timestamp: new Date().toISOString()
    }]
  };
  
  formData.append('payload_json', JSON.stringify(payload));
  
  // Add screenshot if available
  if (screenshotBuffer) {
    formData.append('file', screenshotBuffer, {
      filename: 'screenshot.png',
      contentType: 'image/png'
    });
    console.log('[DISCORD] Screenshot attached');
  }
  
  // Send first message
  const response = await fetch(webhookUrl, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} - ${errorText}`);
  }
  
  console.log('[DISCORD] First message sent successfully');
  
  // Send remaining chunks as follow-up messages
  for (let i = 1; i < chunks.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit protection
    
    const followUpPayload = {
      embeds: [{
        title: `📄 Scraped Content (Part ${i + 1})`,
        description: `\`\`\`\n${chunks[i]}\n\`\`\``,
        color: 0x00ff00
      }]
    };
    
    const followUpResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(followUpPayload)
    });
    
    if (!followUpResponse.ok) {
      console.error(`[DISCORD] Failed to send chunk ${i + 1}`);
    } else {
      console.log(`[DISCORD] Sent chunk ${i + 1}/${chunks.length}`);
    }
  }
}

// Send error notification to Discord
async function sendErrorToDiscord(url, errorMessage) {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  
  if (!webhookUrl) {
    return;
  }
  
  const payload = {
    embeds: [{
      title: '❌ Scraping Failed',
      description: `**URL:** ${url}\n**Error:** \`\`\`${errorMessage}\`\`\``,
      color: 0xff0000,
      timestamp: new Date().toISOString()
    }]
  };
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  console.log('[DISCORD] Error notification sent');
}

// Routes
app.get('/', (req, res) => {
  res.send('🚀 Professional Scraper API Running');
});

app.get('/send', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).send('Missing "url" query parameter');
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch {
    return res.status(400).send('Invalid URL format');
  }
  
  // Return immediately with blank page
  res.send('');
  
  // Process scraping in background
  scrapeAndSend(url).catch(error => {
    console.error('[BACKGROUND] Scraping error:', error.message);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    config: {
      screenshotEnabled: CONFIG.takeScreenshot,
      maxScrolls: CONFIG.maxScrolls,
      scrollDelay: CONFIG.scrollDelay
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║   🚀 PROFESSIONAL WEB SCRAPER API                 ║
║   Port: ${PORT}                                    ║
║   Screenshot: ${CONFIG.takeScreenshot ? 'ENABLED' : 'DISABLED'}                        ║
║   Max Scrolls: ${CONFIG.maxScrolls}                               ║
╚═══════════════════════════════════════════════════╝
  `);
  
  if (!process.env.DISCORD_WEBHOOK) {
    console.warn('⚠️  WARNING: DISCORD_WEBHOOK not configured!');
  }
});
