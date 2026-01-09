const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const { JSDOM } = require('jsdom'); // To parse HTML and use document.querySelector

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ===== CONFIG =====
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1459229880221700375/esk71z4kmwuwYOLByflofkjZra-deSo82CK0UogimXJbp0QKB13MLQ4wP3mm-yFrw6rj';
const TARGET_URL = 'https://url-shortener.me/726T+';
// ==================

app.get('/send', async (req, res) => {
    try {
        const response = await fetch(TARGET_URL);
        const html = await response.text();

        // Parse HTML with jsdom
        const dom = new JSDOM(html);
        const document = dom.window.document;

        // Your two selectors
        const selector1 = "#yDmH0d > c-wiz > div > div:nth-child(2) > div:nth-child(3) > c-wiz > c-wiz > div > div.lEXd0c.G6iXBe > div > div:nth-child(3) > div > div > div:nth-child(5) > a > div > div.At4TMd > div.eEhIle > div > div > div";
        const selector2 = "#yDmH0d > c-wiz > div > div:nth-child(2) > div:nth-child(3) > c-wiz > c-wiz > div > div.lEXd0c.G6iXBe > div > div:nth-child(3) > div > div > div:nth-child(4) > a > div > div.At4TMd > div.eEhIle > div > div:nth-child(1) > div";

        const text1 = document.querySelector(selector1)?.textContent.trim() || "Element 1 not found";
        const text2 = document.querySelector(selector2)?.textContent.trim() || "Element 2 not found";

        // Send to Discord
        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `Text 1: ${text1}\nText 2: ${text2}` })
        });

        res.send("Scraped text sent to Discord!");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching page or sending to Discord");
    }
});

app.get('/', (req, res) => res.send("Scraper API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
