require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { initDB, loadSession, saveSession, pool } = require('./db');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const axios = require('axios');

const SESSION_ID = 'astro_bot_main';

// --- AI Logic ---
async function getAstroReply(text, context) {
  const prompt = `You are an expert Vedic Astrologer receptionist. Language: Hindi/English mix. User Context: ${context || 'New User'}. User Query: "${text}". Reply politely in under 40 words.`;
  
  try {
    const res = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
      { inputs: prompt },
      { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` }, timeout: 5000 }
    );
    let textOut = res.data[0]?.generated_text || "";
    return textOut.split(prompt)[1] || textOut.trim() || "Namaste! Kripya apna sawaal spasht karein.";
  } catch (e) {
    console.error("AI Error:", e.message);
    return "Namaste! System abhi busy hai. Kripya 1 minute baad try karein.";
  }
}

async function connectToWhatsApp() {
  await initDB();

  const storedCreds = await loadSession(SESSION_ID);
  
  let authState;
  if (storedCreds) {
    console.log('📂 Loaded session from Database.');
    authState = {
      state: { creds: storedCreds, keys: {} },
      saveCreds: async () => {
        await saveSession(SESSION_ID, authState.state.creds);
      }
    };
  } else {
    console.log('🆕 No session found. Generating new QR...');
    const { state, saveCreds } = await useMultiFileAuthState(`temp_auth_${SESSION_ID}`);
    authState = {
      state: state,
      saveCreds: async () => {
        await saveSession(SESSION_ID, state.creds);
      }
    };
  }

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: authState.state,
    browser: ["Ubuntu", "Chrome", "115.0.0.0"],
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', authState.saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n🔳 SCAN THIS QR CODE TO LINK WHATSAPP:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log('⚠️ Connection closed. Reconnecting:', shouldReconnect);
      
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 2000);
      } else {
        console.log('❌ Logged out. Clearing session.');
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
      const res = await pool.query('SELECT * FROM clients WHERE phone_number = $1', [phoneNumber]);
      let context = '';
      if (res.rows.length > 0) {
        const row = res.rows[0];
        context = `Name: ${row.name}, DOB: ${row.dob}`;
      } else {
        await pool.query('INSERT INTO clients (phone_number) VALUES ($1)', [phoneNumber]);
      }

      const reply = await getAstroReply(text, context);
      await sock.sendMessage(phoneNumber + '@s.whatsapp.net', { text: reply.trim() });
      
    } catch (err) {
      console.error(err);
      await sock.sendMessage(phoneNumber + '@s.whatsapp.net', { text: "Sorry, technical issue." });
    }
  });
}

// Start the bot
connectToWhatsApp();
