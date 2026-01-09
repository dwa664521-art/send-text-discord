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
  maxScrolls: parseInt(process.env.MAX_SCROLLS) || 10,
  scrollDelay: parseInt(process.env.SCROLL_DELAY) || 800,
  pageLoadTimeout: parseInt(process.env.PAGE_LOAD_TIMEOUT) || 120000,
  discordCharLimit: 1900,
  maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH) || 50000 // Prevent massive text dumps
};

// Utility: Resolve shortened URLs
async function resolveShortUrl(url) {
  try {
    console.log(`[URL] Attempting to resolve: ${url}`);
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      timeout: 10000
    });
    const resolvedUrl = response.url;
    if (resolvedUrl !== url) {
      console.log(`[URL] Resolved to: ${resolvedUrl}`);
      return resolvedUrl;
    }
    return url;
  } catch (error) {
    console.log(`[URL] Could not resolve, using original: ${error.message}`);
    return url;
  }
}

// Utility: Split text into Discord-safe chunks
function chunkText(text, limit) {
  if (!text || text.length === 0) {
    return ['[No text content extracted]'];
  }
  
  // Truncate if too long
  if (text.length > CONFIG.maxTextLength) {
    text = text.substring(0, CONFIG.maxTextLength) + '\n\n... [Text truncated due to length]';
  }
  
  const chunks = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    
    // Find best breaking point
    let breakPoint = remaining.lastIndexOf('\n\n', limit); // Paragraph break
    if (breakPoint === -1) {
      breakPoint = remaining.lastIndexOf('\n', limit); // Line break
    }
    if (breakPoint === -1) {
      breakPoint = remaining.lastIndexOf('. ', limit); // Sentence break
    }
    if (breakPoint === -1) {
      breakPoint = remaining.lastIndexOf(' ', limit); // Word break
    }
    if (breakPoint === -1) {
      breakPoint = limit; // Force break
    }
    
    chunks.push(remaining.substring(0, breakPoint));
    remaining = remaining.substring(breakPoint).trim();
  }
  
  return chunks;
}

// Utility: Smart auto-scroll with dynamic stopping
async function autoScroll(page, maxScrolls, delay) {
  try {
    console.log(`[SCROLL] Starting intelligent auto-scroll`);
    
    let scrollCount = 0;
    let previousHeight = 0;
    let unchangedCount = 0;
    const maxUnchanged = 3; // Stop after 3 unchanged scrolls
    
    while (scrollCount < maxScrolls) {
      try {
        const currentHeight = await page.evaluate(() => {
          return document.body ? document.body.scrollHeight : 0;
        });
        
        if (currentHeight === 0) {
          console.log('[SCROLL] Warning: scrollHeight is 0, skipping scroll');
          break;
        }
        
        // Check if page stopped growing
        if (currentHeight === previousHeight) {
          unchangedCount++;
          console.log(`[SCROLL] Height unchanged (${unchangedCount}/${maxUnchanged})`);
          
          if (unchangedCount >= maxUnchanged) {
            console.log('[SCROLL] Page fully loaded, ending scroll');
            break;
          }
        } else {
          unchangedCount = 0; // Reset counter if page grew
        }
        
        previousHeight = currentHeight;
        
        // Scroll to bottom
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        // Wait for content to load
        await page.waitForTimeout(delay);
        scrollCount++;
        console.log(`[SCROLL] Scroll ${scrollCount}/${maxScrolls} | Height: ${currentHeight}px`);
        
      } catch (scrollError) {
        console.error(`[SCROLL] Error during scroll ${scrollCount}:`, scrollError.message);
        break;
      }
    }
    
    // Scroll back to top for consistent screenshots
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(500);
    console.log('[SCROLL] Completed scrolling sequence');
    
  } catch (error) {
    console.error('[SCROLL] Fatal scroll error:', error.message);
  }
}

// Wait for page to be fully stable
async function waitForPageStable(page, timeout = 5000) {
  try {
    console.log('[STABILITY] Waiting for page to stabilize...');
    await page.waitForFunction(
      () => document.readyState === 'complete',
      { timeout }
    );
    await page.waitForTimeout(1000); // Extra buffer
    console.log('[STABILITY] Page stable');
  } catch (error) {
    console.log('[STABILITY] Timeout reached, continuing anyway');
  }
}

// Main scraping function
async function scrapeAndSend(url) {
  let browser;
  const startTime = Date.now();
  
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[START] New scraping job`);
    console.log(`[URL] ${url}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Resolve shortened URLs
    const resolvedUrl = await resolveShortUrl(url);
    
    // Launch Puppeteer with production-grade settings
    console.log('[BROWSER] Launching Puppeteer with optimized settings...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--safebrowsing-disable-auto-update',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      timeout: 60000
    });
    
    console.log('[BROWSER] ✓ Browser launched successfully');
    
    const page = await browser.newPage();
    console.log('[BROWSER] ✓ New page created');
    
    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set viewport for desktop experience
    await page.setViewport({ width: 1920, height: 1080 });
    console.log('[BROWSER] ✓ Viewport configured');
    
    // Set extra headers to appear more like real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    
    // Navigate to page with extended timeout
    console.log('[BROWSER] Navigating to target URL...');
    const response = await page.goto(resolvedUrl, {
      waitUntil: 'networkidle2',
      timeout: CONFIG.pageLoadTimeout
    });
    
    const statusCode = response ? response.status() : 'Unknown';
    console.log(`[BROWSER] ✓ Page loaded | Status: ${statusCode}`);
    
    // Wait for page stability
    await waitForPageStable(page);
    
    // Perform intelligent auto-scroll
    await autoScroll(page, CONFIG.maxScrolls, CONFIG.scrollDelay);
    
    // Extract page metadata
    console.log('[EXTRACT] Gathering page metadata...');
    const metadata = await page.evaluate(() => {
      return {
        title: document.title || '[No title]',
        url: window.location.href,
        loadedResources: performance.getEntriesByType('resource').length
      };
    }).catch(() => ({ title: '[Unknown]', url: resolvedUrl, loadedResources: 0 }));
    
    console.log(`[EXTRACT] Title: ${metadata.title}`);
    console.log(`[EXTRACT] Resources loaded: ${metadata.loadedResources}`);
    
    // Extract all visible text with multiple fallback methods
    console.log('[EXTRACT] Extracting visible text content...');
    let pageText = '';
    
    try {
      pageText = await page.evaluate(() => {
        // Method 1: Try innerText (best for visible text)
        try {
          if (document.body && document.body.innerText) {
            const text = document.body.innerText;
            if (text && text.trim().length > 0) {
              return text;
            }
          }
        } catch (e) {
          console.error('innerText failed:', e);
        }
        
        // Method 2: Try textContent
        try {
          if (document.body && document.body.textContent) {
            const text = document.body.textContent;
            if (text && text.trim().length > 0) {
              return text;
            }
          }
        } catch (e) {
          console.error('textContent failed:', e);
        }
        
        // Method 3: Manual extraction from visible elements
        try {
          const elements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, span, div, a, button');
          const texts = [];
          elements.forEach(el => {
            const text = el.innerText || el.textContent;
            if (text && text.trim()) {
              texts.push(text.trim());
            }
          });
          if (texts.length > 0) {
            return texts.join('\n');
          }
        } catch (e) {
          console.error('Manual extraction failed:', e);
        }
        
        // Method 4: Last resort - documentElement
        try {
          return document.documentElement.textContent || '[No text content available]';
        } catch (e) {
          return '[Text extraction completely failed]';
        }
      });
      
      if (!pageText || pageText.trim().length === 0) {
        pageText = '[No visible text content found on page]';
      }
      
      // Clean up excessive whitespace
      pageText = pageText.replace(/\n{3,}/g, '\n\n').trim();
      
      console.log(`[EXTRACT] ✓ Extracted ${pageText.length.toLocaleString()} characters`);
      console.log(`[EXTRACT] ✓ Text preview: ${pageText.substring(0, 100)}...`);
      
    } catch (extractError) {
      console.error('[EXTRACT] ✗ Error extracting text:', extractError.message);
      pageText = `[Error during text extraction: ${extractError.message}]`;
    }
    
    // Take screenshot if enabled
    let screenshotBuffer = null;
    if (CONFIG.takeScreenshot) {
      try {
        console.log('[SCREENSHOT] Capturing full-page screenshot...');
        screenshotBuffer = await page.screenshot({
          fullPage: true,
          type: 'png',
          captureBeyondViewport: true
        });
        const sizeKB = (screenshotBuffer.length / 1024).toFixed(2);
        console.log(`[SCREENSHOT] ✓ Screenshot captured (${sizeKB} KB)`);
      } catch (screenshotError) {
        console.error('[SCREENSHOT] ✗ Error capturing screenshot:', screenshotError.message);
      }
    } else {
      console.log('[SCREENSHOT] Skipped (disabled in config)');
    }
    
    // Close browser before sending to Discord
    console.log('[BROWSER] Closing browser...');
    await browser.close();
    browser = null;
    console.log('[BROWSER] ✓ Browser closed cleanly');
    
    // Calculate execution time
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[TIMING] Total execution time: ${executionTime}s`);
    
    // Send to Discord
    await sendToDiscord(resolvedUrl, pageText, screenshotBuffer, metadata, executionTime);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[SUCCESS] Job completed successfully`);
    console.log(`${'='.repeat(60)}\n`);
    
    return { success: true, executionTime };
    
  } catch (error) {
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n${'='.repeat(60)}`);
    console.error('[ERROR] Scraping job failed');
    console.error('[ERROR] Message:', error.message);
    console.error('[ERROR] Time elapsed:', executionTime + 's');
    console.error(`${'='.repeat(60)}\n`);
    
    if (browser) {
      try {
        await browser.close();
        console.log('[CLEANUP] ✓ Browser closed after error');
      } catch (closeError) {
        console.error('[CLEANUP] ✗ Error closing browser:', closeError.message);
      }
    }
    
    // Send detailed error to Discord
    try {
      await sendErrorToDiscord(url, error.message, error.stack, executionTime);
    } catch (discordError) {
      console.error('[ERROR] Failed to send error notification to Discord:', discordError.message);
    }
    
    throw error;
  }
}

// Send results to Discord webhook
async function sendToDiscord(url, text, screenshotBuffer, metadata, executionTime) {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  
  if (!webhookUrl) {
    throw new Error('DISCORD_WEBHOOK not configured in .env');
  }
  
  console.log('[DISCORD] Preparing payload for webhook...');
  
  // Prepare text chunks
  const chunks = chunkText(text, CONFIG.discordCharLimit);
  console.log(`[DISCORD] Split into ${chunks.length} chunk(s)`);
  
  // Prepare first message with metadata
  const formData = new FormData();
  
  const payload = {
    content: `**🔍 Web Scraping Complete**\n\`\`\`📊 Job Summary\nURL: ${url}\nTitle: ${metadata.title}\nExecution Time: ${executionTime}s\nText Length: ${text.length.toLocaleString()} chars\nChunks: ${chunks.length}\nScreenshot: ${screenshotBuffer ? 'Yes' : 'No'}\`\`\``,
    embeds: [{
      title: '📄 Content (Part 1 of ' + chunks.length + ')',
      description: chunks[0].length > 1800 ? chunks[0].substring(0, 1800) + '...' : chunks[0],
      color: 0x00ff00,
      footer: {
        text: `Scraped at ${new Date().toLocaleString()}`
      }
    }]
  };
  
  formData.append('payload_json', JSON.stringify(payload));
  
  // Add screenshot to first message if available
  if (screenshotBuffer) {
    formData.append('file', screenshotBuffer, {
      filename: 'screenshot.png',
      contentType: 'image/png'
    });
    console.log('[DISCORD] Screenshot attached to message');
  }
  
  // Send first message
  console.log('[DISCORD] Sending message 1/' + chunks.length + '...');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} - ${errorText}`);
  }
  
  console.log('[DISCORD] ✓ Message 1/' + chunks.length + ' sent');
  
  // Send remaining chunks as follow-up messages
  for (let i = 1; i < chunks.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 1200)); // Rate limit protection
    
    const followUpPayload = {
      embeds: [{
        title: `📄 Content (Part ${i + 1} of ${chunks.length})`,
        description: chunks[i].length > 1800 ? chunks[i].substring(0, 1800) + '...' : chunks[i],
        color: 0x00ff00
      }]
    };
    
    console.log(`[DISCORD] Sending message ${i + 1}/${chunks.length}...`);
    const followUpResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(followUpPayload)
    });
    
    if (!followUpResponse.ok) {
      console.error(`[DISCORD] ✗ Failed to send chunk ${i + 1}`);
    } else {
      console.log(`[DISCORD] ✓ Message ${i + 1}/${chunks.length} sent`);
    }
  }
  
  console.log('[DISCORD] ✓ All messages sent successfully');
}

// Send error notification to Discord
async function sendErrorToDiscord(url, errorMessage, stackTrace, executionTime) {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  
  if (!webhookUrl) {
    return;
  }
  
  try {
    const payload = {
      embeds: [{
        title: '❌ Scraping Job Failed',
        description: `**URL:** ${url}\n**Execution Time:** ${executionTime}s\n**Error:**\n\`\`\`${errorMessage}\`\`\``,
        color: 0xff0000,
        fields: stackTrace ? [{
          name: 'Stack Trace',
          value: '```' + stackTrace.substring(0, 900) + '```'
        }] : [],
        timestamp: new Date().toISOString()
      }]
    };
    
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log('[DISCORD] ✓ Error notification sent');
  } catch (err) {
    console.error('[DISCORD] ✗ Failed to send error notification:', err.message);
  }
}

// Routes
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Web Scraper API</title>
      <style>
        body { font-family: monospace; padding: 40px; background: #0d1117; color: #c9d1d9; }
        h1 { color: #58a6ff; }
        code { background: #161b22; padding: 2px 6px; border-radius: 3px; }
        .endpoint { background: #161b22; padding: 15px; margin: 10px 0; border-radius: 6px; }
        .status { color: #3fb950; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>🚀 Professional Web Scraper API</h1>
      <p class="status">✓ Status: Running</p>
      <div class="endpoint">
        <strong>Scrape Endpoint:</strong><br>
        <code>GET /send?url=YOUR_URL_HERE</code>
      </div>
      <div class="endpoint">
        <strong>Health Check:</strong><br>
        <code>GET /health</code>
      </div>
      <p>Made with ❤️ for bulletproof web scraping</p>
    </body>
    </html>
  `);
});

app.get('/send', async (req, res) => {
  const { url } = req.query;
  
  console.log('\n[REQUEST] New scrape request received');
  
  if (!url) {
    console.log('[REQUEST] ✗ Missing URL parameter');
    return res.status(400).send('❌ Missing "url" query parameter. Usage: /send?url=YOUR_URL');
  }
  
  // Validate URL format
  try {
    new URL(url);
    console.log(`[REQUEST] ✓ Valid URL format: ${url}`);
  } catch {
    console.log('[REQUEST] ✗ Invalid URL format');
    return res.status(400).send('❌ Invalid URL format. Please provide a valid HTTP/HTTPS URL.');
  }
  
  // Return immediately
  res.send('✓ Scraping job started. Results will be sent to Discord.');
  console.log('[REQUEST] Response sent, starting background job...');
  
  // Process in background
  scrapeAndSend(url).catch(error => {
    console.error('[BACKGROUND] Job failed:', error.message);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    config: {
      screenshotEnabled: CONFIG.takeScreenshot,
      maxScrolls: CONFIG.maxScrolls,
      scrollDelay: CONFIG.scrollDelay,
      pageLoadTimeout: CONFIG.pageLoadTimeout,
      maxTextLength: CONFIG.maxTextLength
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
      },
      hasWebhook: !!process.env.DISCORD_WEBHOOK,
      hasPuppeteerPath: !!process.env.PUPPETEER_EXECUTABLE_PATH
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║         🚀 WEB SCRAPER API STARTED                ║
╠═══════════════════════════════════════════════════╣
║  Port:          ${PORT.toString().padEnd(33)} ║
║  Node:          ${process.version.padEnd(33)} ║
║  Platform:      ${process.platform.padEnd(33)} ║
╠═══════════════════════════════════════════════════╣
║  Screenshot:    ${(CONFIG.takeScreenshot ? 'ENABLED' : 'DISABLED').padEnd(33)} ║
║  Max Scrolls:   ${CONFIG.maxScrolls.toString().padEnd(33)} ║
║  Scroll Delay:  ${CONFIG.scrollDelay.toString().padEnd(33)}ms ║
║  Load Timeout:  ${(CONFIG.pageLoadTimeout / 1000).toString().padEnd(33)}s ║
╠═══════════════════════════════════════════════════╣
║  Webhook:       ${(process.env.DISCORD_WEBHOOK ? '✓ CONFIGURED' : '✗ NOT SET').padEnd(33)} ║
╚═══════════════════════════════════════════════════╝

📝 Endpoints Available:
   → GET /              Homepage
   → GET /send?url=...  Trigger scrape
   → GET /health        Health check

✨ Ready to scrape!
  `);
});
