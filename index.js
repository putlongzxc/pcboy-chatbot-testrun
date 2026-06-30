const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// ==============================
// Verify Webhook
// ==============================
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook Verified!");
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
});

// ==============================
// Receive Messages
// ==============================
app.post("/webhook", async (req, res) => {
    const body = req.body;

    if (body.object === "page") {
        for (const entry of body.entry) {
            const webhookEvent = entry.messaging[0];

            if (webhookEvent.message && !webhookEvent.message.is_echo) {
                const senderId = webhookEvent.sender.id;

                await sendMessage(
                    senderId,
                    "👋 Hello! Welcome to PCBOY Phone·Computer Sales & Repair Services.\n\nThis chatbot is now working successfully!"
                );
            }

            if (webhookEvent.postback) {
                const senderId = webhookEvent.sender.id;

                await sendMessage(
                    senderId,
                    "You clicked: " + webhookEvent.postback.payload
                );
            }
        }
    }

    res.sendStatus(200);
});

// ==============================
// Send Message Function
// ==============================
async function sendMessage(recipientId, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v23.0/me/messages`,
            {
                recipient: {
                    id: recipientId
                },
                message: {
                    text: text
                }
            },
            {
                params: {
                    access_token: PAGE_ACCESS_TOKEN
                }
            }
        );
    } catch (error) {
        console.error(
            error.response ? error.response.data : error.message
        );
    }
}

// ==============================
// Home Route
// ==============================
app.get("/", (req, res) => {
    res.send("PCBOY Chat Assist is Running!");
});

// ==============================
// Start Server
// ==============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
