require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, BufferJSON } = require('@whiskeysockets/baileys');
const { initDB, loadSession, saveSession, pool } = require('./db');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const axios = require('axios');

const SESSION_ID = 'astro_bot_main'; // Unique ID for this bot

// --- AI Logic (Simple Fallback) ---
async function getAstroReply(text, context) {
  // Yahan aap Gemini/HF API call laga sakte hain. Filhal simple logic hai.
  const prompt = `You are an Astrologer. User: ${context || 'New'}. Query: ${text}. Reply short Hindi.`;
  
  try {
    // Example: Hugging Face Call
    const res = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
      { inputs: prompt },
      { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` } }
    );
    return res.data[0]?.generated_text?.split(prompt)[1] || "Stars are aligning...";
  } catch (e) {
    return "Namaste! System busy hai. Kripya baad mein try karein.";
  }
}

async function connectToWhatsApp() {
  await initDB();

  // Load existing session from Neon DB
  const storedCreds = await loadSession(SESSION_ID);

  let authState;
  
  if (storedCreds) {
    console.log('📂 Loaded session from Database.');
    // Baileys expects specific structure, we reconstruct it
    authState = {
      state: { creds: storedCreds, keys: {} }, // Keys usually empty if not using multi-device fully, but creds are key
      saveCreds: async () => {
        await saveSession(SESSION_ID, authState.state.creds);
      }
    };
  } else {
    console.log('🆕 No session found. Generating new QR...');
    // Fallback to memory auth if DB fail (rare), but ideally we force DB usage
    // For simplicity in this snippet, we simulate the state object creation
    const { state, saveCreds } = await useMultiFileAuthState(`temp_auth_${SESSION_ID}`);
    
    // Override saveCreds to save to DB instead of file
    authState = {
      state: state,
      saveCreds: async () => {
        await saveSession(SESSION_ID, state.creds);
      }
    };
  }

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false, // We will print manually
    auth: authState.state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    markOnlineOnConnect: true
  });

  // Override the internal saveCreds to use our DB function
  sock.ev.on('creds.update', authState.saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n🔳 SCAN THIS QR CODE TO LINK WHATSAPP:\n');
      qrcode.generate(qr, { small: true });
      // NOTE: In Render logs, QR might appear as text blocks. Copy-paste to a QR scanner if image doesn't render well.
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('⚠️ Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 2000);
      } else {
        console.log('❌ Logged out. Please delete session from DB and restart.');
        // Optional: Clear DB session here if logged out intentionally
        await pool.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [SESSION_ID]);
        process.exit(0);
      }
    } else if (connection === 'open') {
      console.log('✅ CONNECTED SUCCESSFULLY! Astro Bot is Live.');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const message = m.messages[0];
    if (!message.message || message.key.fromMe) return;
    if (message.key.remoteJid.includes('group')) return;

    const phoneNumber = message.key.remoteJid.split('@')[0];
    const text = message.conversation || message.extendedTextMessage?.text;
    if (!text) return;

    console.log(`📨 From ${phoneNumber}: ${text}`);

    try {
      // Get User Context from DB
      const res = await pool.query('SELECT * FROM clients WHERE phone_number = $1', [phoneNumber]);
      let context = '';
      if (res.rows.length > 0) {
        const row = res.rows[0];
        context = `Name: ${row.name}, DOB: ${row.dob}`;
      } else {
        await pool.query('INSERT INTO clients (phone_number) VALUES ($1)', [phoneNumber]);
      }

      // Get AI Reply
      const reply = await getAstroReply(text, context);

      // Send Reply
      await sock.sendMessage(phoneNumber + '@s.whatsapp.net', { text: reply.trim() });
      
    } catch (err) {
      console.error(err);
      await sock.sendMessage(phoneNumber + '@s.whatsapp.net', { text: "Error processing request." });
    }
  });
}

connectToWhatsApp();