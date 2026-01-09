const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ====== CONFIG ======
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1459229880221700375/esk71z4kmwuwYOLByflofkjZra-deSo82CK0UogimXJbp0QKB13MLQ4wP3mm-yFrw6rj';
const TARGET_URL = 'https://myaccount.google.com/personal-info';
// ====================

app.get('/send', async (req, res) => {
    try {
        const pageRes = await fetch(TARGET_URL);
        const text = await pageRes.text();

        // Split into chunks of 1900 chars to fit Discord limit
        for (let i = 0; i < text.length; i += 1900) {
            const chunk = text.slice(i, i + 1900);
            await fetch(DISCORD_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: "```" + chunk + "```" })
            });
        }

        res.send("Page text sent to Discord!");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching page or sending to Discord");
    }
});

app.get('/', (req, res) => res.send("Text scraper API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
