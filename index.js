const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ===== CONFIG =====
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1459229880221700375/esk71z4kmwuwYOLByflofkjZra-deSo82CK0UogimXJbp0QKB13MLQ4wP3mm-yFrw6rj';
const TARGET_URL = 'https://url-shortener.me/726T+';
// ==================

app.get('/send', async (req, res) => {
    try {
        // Launch headless browser
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

        // Scroll to bottom to load all lazy content
        await autoScroll(page);

        // Grab all visible text
        const visibleText = await page.evaluate(() => {
            // Get all elements that are visible
            const elements = Array.from(document.body.querySelectorAll('*'));
            return elements
                .filter(el => {
                    const style = window.getComputedStyle(el);
                    return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
                })
                .map(el => el.innerText)
                .filter(text => text.trim().length > 0)
                .join('\n');
        });

        await browser.close();

        // Send text to Discord in chunks (2000 char limit)
        for (let i = 0; i < visibleText.length; i += 1900) {
            const chunk = visibleText.slice(i, i + 1900);
            await fetch(DISCORD_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: "```" + chunk + "```" }),
            });
        }

        res.send("All visible text sent to Discord!");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error scraping page or sending to Discord");
    }
});

// Auto-scroll helper
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
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

app.get('/', (req, res) => res.send("Visible Text Scraper API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
