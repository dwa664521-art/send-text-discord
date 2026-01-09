const express = require("express");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");
const FormData = require("form-data");

const app = express();

// ===== CONFIG =====
const TARGET_URL = "https://url-shortener.me/726T";
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1459229880221700375/esk71z4kmwuwYOLByflofkjZra-deSo82CK0UogimXJbp0QKB13MLQ4wP3mm-yFrw6rj";
// ==================

app.get("/send", async (req, res) => {
  try {
    // 1️⃣ Show simple white screen in browser
    res.send(`
      <html>
        <head>
          <title>Loading...</title>
          <style>body{background:white;margin:0;padding:0;}</style>
        </head>
        <body></body>
      </html>
    `);

    // 2️⃣ Run scraper in background
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "networkidle2" });

    // Scroll down to load all content (for lazy-loading pages)
    await autoScroll(page);

    // Grab all visible text
    const visibleText = await page.evaluate(() => {
      const elements = Array.from(document.body.querySelectorAll("*"));
      return elements
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style && style.display !== "none" && style.visibility !== "hidden" && el.offsetHeight > 0;
        })
        .map(el => el.innerText)
        .filter(text => text.trim().length > 0)
        .join("\n");
    });

    // Take full-page screenshot
    const screenshotBuffer = await page.screenshot({ fullPage: true });

    await browser.close();

    // 3️⃣ Send visible text to Discord in chunks
    for (let i = 0; i < visibleText.length; i += 1900) {
      const chunk = visibleText.slice(i, i + 1900);
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "```" + chunk + "```" }),
      });
    }

    // 4️⃣ Send screenshot to Discord
    const form = new FormData();
    form.append("file", screenshotBuffer, "screenshot.png");
    await fetch(DISCORD_WEBHOOK, { method: "POST", body: form });
    
    console.log("Text + Screenshot sent successfully!");
  } catch (err) {
    console.error("Error:", err);
  }
});

// Helper function to auto-scroll
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 200;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

app.get("/", (req, res) => res.send("Visible Text + Screenshot Scraper API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
