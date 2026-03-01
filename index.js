require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, BufferJSON } = require('@whiskeysockets/baileys');
const { initDB, loadSession, saveSession, pool } = require('./db');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const axios = require('axios');
const Boom = require('@hapi/boom'); // Added for better error handling

const SESSION_ID = 'astro_bot_main';

// --- AI Logic (Simple Fallback) ---
async function getAstroReply(text, context) {
  const prompt = `You are an expert Vedic Astrologer receptionist named 'Jyotish Mitra'. Language: Hindi (mixed with English). Tone: Polite, Professional. User Context: ${context || 'New User'}. User Query: "${text}". Instructions: 1. If details (Name, DOB, Time, Place) are missing, ask politely. 2. If details exist, give a short positive insight. 3. Keep reply under 40 words.`;
  
  try {
    const res = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
      { inputs: prompt },
      { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` }, timeout: 5000 }
    );
    let textOut = res.data[0]?.generated_text || "";
    return textOut.split(prompt)[
