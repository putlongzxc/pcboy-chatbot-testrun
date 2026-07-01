/**
 * PCBOY Phone•Computer Sales & Repair Services
 * Facebook Messenger Chatbot
 *
 * Stack: Node.js (v20+), Express 4.x, Axios
 * Hosting: Render.com (Free Plan)
 *
 * Required Environment Variables:
 *   PAGE_ACCESS_TOKEN  - Facebook Page access token
 *   VERIFY_TOKEN       - Token used for webhook verification
 *   APP_SECRET         - (optional) Facebook App Secret
 */

'use strict';

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Environment Variables
// ---------------------------------------------------------------------------
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.APP_SECRET || null;
const PORT = process.env.PORT || 3000;

const GRAPH_API_URL = 'https://graph.facebook.com/v19.0/me/messages';

// ---------------------------------------------------------------------------
// Postback / Payload Constants
// ---------------------------------------------------------------------------
const PAYLOADS = {
  GET_STARTED: 'GET_STARTED',
  MAIN_MENU: 'MAIN_MENU',
  COMPUTER_REPAIR: 'COMPUTER_REPAIR',
  PHONE_REPAIR: 'PHONE_REPAIR',
  MORE_SERVICES: 'MORE_SERVICES',
  LAPTOP_REPAIR: 'LAPTOP_REPAIR',
  CLEANING: 'CLEANING',
  DEVICE_SALES: 'DEVICE_SALES',
  HARDWARE_UPGRADE: 'HARDWARE_UPGRADE',
  OTHER_INQUIRY: 'OTHER_INQUIRY',
};

const HUMAN_TAKEOVER_NOTE =
  'If you would like immediate assistance, simply continue chatting and one of our technicians will respond.';

// ---------------------------------------------------------------------------
// Duplicate-Event Protection
// ---------------------------------------------------------------------------
// Facebook can redeliver the same webhook event (retries on timeout/network
// issues, or occasional platform-level duplicate delivery) even after we've
// already responded 200 OK. Without dedup, this causes the bot to send the
// same menu/reply twice to a customer. We keep a short-lived cache of event
// keys we've already handled and skip anything we've seen before.
const processedEvents = new Map(); // key -> timestamp (ms)
const DEDUPE_TTL_MS = 5 * 60 * 1000; // remember keys for 5 minutes

function isDuplicateEvent(key) {
  if (!key) return false; // if we can't build a reliable key, don't block it

  if (processedEvents.has(key)) {
    return true;
  }
  processedEvents.set(key, Date.now());
  return false;
}

// Periodically clear out old keys so the Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of processedEvents) {
    if (now - ts > DEDUPE_TTL_MS) {
      processedEvents.delete(key);
    }
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Per-User Serialization
// ---------------------------------------------------------------------------
// If two events for the same user arrive back-to-back (e.g. a fast double
// tap on a button, or FB firing a message + postback close together), we
// don't want them processed concurrently - that can interleave two menu
// sends. This chains each user's events onto a single promise so they run
// one at a time, in order.
const userQueues = new Map(); // senderId -> Promise chain

function runSerialized(senderId, task) {
  const previous = userQueues.get(senderId) || Promise.resolve();
  const next = previous.then(task).catch((err) => {
    console.error(`Error processing event for ${senderId}:`, err.message);
  });
  userQueues.set(senderId, next);

  // Prevent unbounded growth of the map once the chain settles.
  next.finally(() => {
    if (userQueues.get(senderId) === next) {
      userQueues.delete(senderId);
    }
  });

  return next;
}

// ---------------------------------------------------------------------------
// Messenger API Helper Functions
// ---------------------------------------------------------------------------

/**
 * Send a plain text message to a user.
 * @param {string} recipientId
 * @param {string} text
 */
async function sendText(recipientId, text) {
  await callSendAPI({
    recipient: { id: recipientId },
    message: { text },
  });
}

/**
 * Send a button template message.
 * @param {string} recipientId
 * @param {string} text
 * @param {Array<{title: string, payload: string}>} buttons
 */
async function sendButtons(recipientId, text, buttons) {
  const formattedButtons = buttons.map((btn) => ({
    type: 'postback',
    title: btn.title,
    payload: btn.payload,
  }));

  await callSendAPI({
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons: formattedButtons,
        },
      },
    },
  });
}

/**
 * Send a text message with quick replies attached.
 * @param {string} recipientId
 * @param {string} text
 * @param {Array<{title: string, payload: string}>} quickReplies
 */
async function sendQuickReplies(recipientId, text, quickReplies) {
  const formattedQuickReplies = quickReplies.map((qr) => ({
    content_type: 'text',
    title: qr.title,
    payload: qr.payload,
  }));

  await callSendAPI({
    recipient: { id: recipientId },
    message: {
      text,
      quick_replies: formattedQuickReplies,
    },
  });
}

/**
 * Low-level call to the Facebook Send API.
 * @param {object} payload
 */
async function callSendAPI(payload) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('Missing PAGE_ACCESS_TOKEN. Cannot send message.');
    return;
  }

  try {
    await axios.post(GRAPH_API_URL, payload, {
      params: { access_token: PAGE_ACCESS_TOKEN },
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error.response) {
      console.error(
        'Facebook API Error:',
        JSON.stringify(error.response.data, null, 2)
      );
    } else {
      console.error('Facebook API Error:', error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Reusable Quick Reply (Main Menu)
// ---------------------------------------------------------------------------
const MAIN_MENU_QUICK_REPLY = [{ title: '🏠 Main Menu', payload: PAYLOADS.MAIN_MENU }];

/**
 * Sends a service response followed by the human takeover note
 * and a "Main Menu" quick reply.
 * @param {string} recipientId
 * @param {string} message
 */
async function sendServiceResponse(recipientId, message) {
  const fullText = `${message}\n\n${HUMAN_TAKEOVER_NOTE}`;
  await sendQuickReplies(recipientId, fullText, MAIN_MENU_QUICK_REPLY);
}

// ---------------------------------------------------------------------------
// Menu Senders
// ---------------------------------------------------------------------------

/**
 * Sends the welcome message (Get Started).
 */
async function sendWelcomeMessage(recipientId) {
  await sendText(
    recipientId,
    '👋 Welcome to PCBOY Phone•Computer Sales & Repair Services!\n' +
      'Thank you for contacting us.\n' +
      'Please choose the service you need below.'
  );
  await sendMainMenu(recipientId);
}

/**
 * Sends the main menu buttons.
 * Note: Messenger button templates support a max of 3 buttons,
 * so "More Services" is sent as a follow-up quick reply option.
 */
async function sendMainMenu(recipientId) {
  await sendButtons(recipientId, 'How can we help you today?', [
    { title: '📱 Phone Repair', payload: PAYLOADS.PHONE_REPAIR },
    { title: '🖥️ Computer Repair', payload: PAYLOADS.COMPUTER_REPAIR },
    { title: '💻 Mac/Laptop Repair', payload: PAYLOADS.LAPTOP_REPAIR },
  ]);
  await sendQuickReplies(recipientId, 'Or select below:', [
    { title: '🔧 More Services', payload: PAYLOADS.MORE_SERVICES },
  ]);
}

/**
 * Sends the "More Services" submenu.
 */
async function sendMoreServicesMenu(recipientId) {
  await sendButtons(recipientId, 'Please choose one of our additional services:', [
    { title: '🧹 Computer/Laptop Cleaning', payload: PAYLOADS.CLEANING },
    { title: '🛒 Items for Sale', payload: PAYLOADS.DEVICE_SALES },
    { title: '⚙️ Hardware Upgrade', payload: PAYLOADS.HARDWARE_UPGRADE },
  ]);
  await sendQuickReplies(recipientId, 'Or select below:', [
    { title: '💬 Other Inquiry', payload: PAYLOADS.OTHER_INQUIRY },
    { title: '🏠 Main Menu', payload: PAYLOADS.MAIN_MENU },
  ]);
}

// ---------------------------------------------------------------------------
// Postback / Payload Router
// ---------------------------------------------------------------------------

/**
 * Routes a postback payload (or quick reply payload) to the correct handler.
 * @param {string} senderId
 * @param {string} payload
 */
async function handlePayload(senderId, payload) {
  switch (payload) {
    case PAYLOADS.GET_STARTED:
      await sendWelcomeMessage(senderId);
      break;

    case PAYLOADS.MAIN_MENU:
      await sendMainMenu(senderId);
      break;

    case PAYLOADS.COMPUTER_REPAIR:
      await sendServiceResponse(
        senderId,
        '🖥️ Computer Repair\n' +
          'Please send:\n' +
          '• Computer specifications\n' +
          '• Description of the issue\n' +
          '• Photos if available\n\n' +
          'Our technician will reply shortly.'
      );
      break;

    case PAYLOADS.PHONE_REPAIR:
      await sendServiceResponse(
        senderId,
        '📱 Phone Repair\n' +
          'Please send:\n' +
          '• Phone brand\n' +
          '• Phone model\n' +
          '• Description of the issue\n' +
          '• Photos if available\n\n' +
          'Our technician will reply shortly.'
      );
      break;

    case PAYLOADS.MORE_SERVICES:
      await sendMoreServicesMenu(senderId);
      break;

    case PAYLOADS.LAPTOP_REPAIR:
      await sendServiceResponse(
        senderId,
        '💻 Macbook/Laptop Repair\n' +
          'Please send:\n' +
          '• Macbook/Laptop brand\n' +
          '• Macbook/Laptop model\n' +
          '• Description of the issue\n\n' +
          'Our technician will reply shortly.'
      );
      break;

    case PAYLOADS.CLEANING:
      await sendServiceResponse(
        senderId,
        '🧹 Computer/Laptop/Macbook Cleaning\n' +
          'Please send:\n' +
          '• Device brand and model\n' +
          '• Specifications (if known)\n' +
          '• Reason for cleaning (dust, overheating, maintenance, etc.)\n\n' +
          'Our technician will reply shortly.'
      );
      break;

    case PAYLOADS.DEVICE_SALES:
      await sendServiceResponse(
        senderId,
        "🛒 Items for Sale\n" +
          "Tell us what device or accessory you're looking for.\n" +
          "We'll check our stock and reply shortly."
      );
      break;

    case PAYLOADS.HARDWARE_UPGRADE:
      await sendServiceResponse(
        senderId,
        '⚙️ Hardware Upgrade\n' +
          'Tell us what hardware you want to upgrade.\n' +
          'Examples:\n' +
          'RAM\n' +
          'SSD\n' +
          'Graphics Card\n' +
          'Motherboard\n' +
          'CPU\n\n' +
          "We'll assist you shortly."
      );
      break;

    case PAYLOADS.OTHER_INQUIRY:
      await sendServiceResponse(
        senderId,
        '💬 Please describe your concern.\nA member of PCBOY will reply shortly.'
      );
      break;

    default:
      // Unknown payload - fall back to main menu
      await sendMainMenu(senderId);
      break;
  }
}

// ---------------------------------------------------------------------------
// Messaging Event Handler
// ---------------------------------------------------------------------------

/**
 * Handles a single messaging event from the webhook payload.
 * @param {object} event
 */
async function handleMessagingEvent(event) {
  const senderId = event.sender && event.sender.id;
  if (!senderId) return;

  // Ignore echo messages (messages sent by the page itself)
  if (event.message && event.message.is_echo) {
    return;
  }

  // Build a dedupe key for this event so a redelivered webhook doesn't get
  // processed (and replied to) twice.
  let dedupeKey = null;
  if (event.message && event.message.mid) {
    // Messages (including ones carrying a quick_reply payload) have a
    // unique mid - the most reliable dedupe key available.
    dedupeKey = `msg:${event.message.mid}`;
  } else if (event.postback && event.postback.payload) {
    // Postbacks don't have a mid, so combine sender + payload + timestamp.
    dedupeKey = `postback:${senderId}:${event.postback.payload}:${event.timestamp}`;
  }

  if (isDuplicateEvent(dedupeKey)) {
    console.log(`Skipping duplicate event: ${dedupeKey}`);
    return;
  }

  // Process this user's events one at a time, in order, so overlapping
  // events for the same person can't trigger overlapping/duplicate replies.
  await runSerialized(senderId, async () => {
    // Handle postback events (e.g., Get Started button, template buttons)
    if (event.postback && event.postback.payload) {
      await handlePayload(senderId, event.postback.payload);
      return;
    }

    // Handle quick reply payloads (sent as a regular message with quick_reply)
    if (
      event.message &&
      event.message.quick_reply &&
      event.message.quick_reply.payload
    ) {
      await handlePayload(senderId, event.message.quick_reply.payload);
      return;
    }

    // Handle plain text messages - reply with main menu as fallback guidance
    if (event.message && event.message.text) {
      await sendMainMenu(senderId);
      return;
    }
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check route
app.get('/', (req, res) => {
  res.status(200).send('PCBOY Chat Assist is Running!');
});

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified successfully.');
      res.status(200).send(challenge);
    } else {
      console.warn('Webhook verification failed: token mismatch.');
      res.sendStatus(403);
    }
  } else {
    console.warn('Webhook verification failed: missing parameters.');
    res.sendStatus(403);
  }
});

// Webhook event receiver (POST)
app.post('/webhook', async (req, res) => {
  const body = req.body;

  // Log all incoming webhook events
  console.log('Incoming webhook event:', JSON.stringify(body, null, 2));

  // Respond 200 immediately so Facebook doesn't retry/timeout
  res.sendStatus(200);

  if (body.object !== 'page') {
    return;
  }

  try {
    const entries = body.entry || [];

    for (const entry of entries) {
      const messagingEvents = entry.messaging || [];

      for (const event of messagingEvents) {
        await handleMessagingEvent(event);
      }
    }
  } catch (error) {
    console.error('Error processing webhook event:', error.message);
  }
});

// ---------------------------------------------------------------------------
// Server Startup
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`PCBOY Chat Assist is running on port ${PORT}`);

  if (!PAGE_ACCESS_TOKEN) {
    console.warn('Warning: PAGE_ACCESS_TOKEN is not set.');
  }
  if (!VERIFY_TOKEN) {
    console.warn('Warning: VERIFY_TOKEN is not set.');
  }
  if (!APP_SECRET) {
    console.warn('Notice: APP_SECRET is not set (optional).');
  }
});
