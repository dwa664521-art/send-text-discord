require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");
const FormData = require("form-data");

const app = express();
app.use(express.json());

// ===== CONFIG =====
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
if (!DISCORD_WEBHOOK) {
  console.error("❌ DISCORD_WEBHOOK is not set in .env!");
  process.exit(1);
}

// Optional: take screenshot (true/false)
const TAKE_SCREENSHOT = false;

// Max scrolls for lazy loading
const MAX_SCROLLS = 50;

// Scroll delay in ms
const SCROLL_DELAY = 100;

// ------------------

async function scrapePage(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Scroll page to load lazy content
    await autoScroll(page);

    // Grab all visible text
    const visibleText = await page.evaluate(() => document.body.innerText);

    // Optional screenshot
    let screenshotBuffer = null;
    if (TAKE_SCREENSHOT) {
      screenshotBuffer = await page.screenshot({ fullPage: true });
    }

    await browser.close();
    return { visibleText, screenshotBuffer };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// Auto scroll function
async function autoScroll(page) {
  await page.evaluate(
    async (scrollDelay, maxScrolls) => {
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
    },
    SCROLL_DELAY,
    MAX_SCROLLS
  );
}

// Send data to Discord
async function sendToDiscord(text, screenshotBuffer, url) {
  try {
    const form = new FormData();
    if (screenshotBuffer) form.append("file", screenshotBuffer, "screenshot.png");

    const chunkText = text.length > 1800 ? text.slice(0, 1800) + "\n...(truncated)" : text;

    form.append(
      "payload_json",
      JSON.stringify({
        content: `**Scraped URL:** ${url}\n**Visible Text:**\n\`\`\`\n${chunkText}\n\`\`\``,
      })
    );

    await fetch(DISCORD_WEBHOOK, { method: "POST", body: form });
  } catch (err) {
    console.error("❌ Failed to send to Discord:", err);
  }
}

// Endpoint: /send?url=<any URL>
app.get("/send", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("❌ Error: URL query parameter is required: /send?url=...");

  // Send white screen immediately
  res.send(`<html><body style="background:white;"></body></html>`);

  console.log(`🔹 Scraping URL: ${url}`);
  try {
    const { visibleText, screenshotBuffer } = await scrapePage(url);
    await sendToDiscord(visibleText, screenshotBuffer, url);
    console.log(`✅ Scrape complete for ${url}`);
  } catch (err) {
    console.error("❌ Scrape failed:", err);
  }
});

app.get("/", (req, res) => res.send("🔹 Bulletproof Scraper API Running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
