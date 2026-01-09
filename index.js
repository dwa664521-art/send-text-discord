require('dotenv').config();
const express = require("express");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");
const FormData = require("form-data");

const app = express();
app.use(express.json());

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
if (!DISCORD_WEBHOOK) {
  console.error("❌ DISCORD_WEBHOOK environment variable not set!");
  process.exit(1);
}

// Helper: scroll the page to load lazy content
async function autoScroll(page, scrollDelay = 150, maxScrolls = 20) {
  await page.evaluate(async (scrollDelay, maxScrolls) => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      let scrolls = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrolls++;
        if (scrolls >= maxScrolls || totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, scrollDelay);
    });
  }, scrollDelay, maxScrolls);
}

// Endpoint: /send?url=...
app.get("/send", async (req, res) => {
  const targetUrl = req.query.url || "https://url-shortener.me/726T";

  // 1️⃣ Send white screen immediately
  res.send(`
    <html>
      <head>
        <title>Loading...</title>
        <style>
          body {background:white; margin:0; padding:0;}
        </style>
      </head>
      <body></body>
    </html>
  `);

  console.log(`🔹 Scraping started for URL: ${targetUrl}`);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle2" });

    // Scroll to load all lazy content
    await autoScroll(page);

    // Extract all visible text
    const visibleText = await page.evaluate(() => document.body.innerText);

    // Take full-page screenshot
    const screenshotBuffer = await page.screenshot({ fullPage: true });

    await browser.close();

    console.log(`🔹 Sending text and screenshot to Discord...`);

    // Send to Discord in one message with screenshot
    const form = new FormData();
    form.append("file", screenshotBuffer, "screenshot.png");

    const textChunk = visibleText.length > 1800
      ? visibleText.slice(0, 1800) + "…(truncated)"
      : visibleText;

    form.append("payload_json", JSON.stringify({
      content: `**Scraped URL:** ${targetUrl}\n**Visible Text:**\n\`\`\`\n${textChunk}\n\`\`\``
    }));

    await fetch(DISCORD_WEBHOOK, { method: "POST", body: form });

    console.log(`✅ Successfully sent to Discord for ${targetUrl}`);
  } catch (err) {
    console.error("❌ Error scraping/sending:", err);
  }
});

app.get("/", (req, res) => res.send("Professional Scraper API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
