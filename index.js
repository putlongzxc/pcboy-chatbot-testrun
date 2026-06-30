const express = require("express");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "pcboy_verify_token";

// Verify webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Receive messages
app.post("/webhook", (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Messenger Bot Running!");
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
