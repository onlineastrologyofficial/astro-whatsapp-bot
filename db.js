const { Pool } = require('pg');

// Neon DB Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Table create karna agar nahi hai
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id SERIAL PRIMARY KEY,
        session_id TEXT UNIQUE NOT NULL,
        creds_json TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS clients (
        phone_number TEXT PRIMARY KEY,
        name TEXT,
        dob TEXT,
        birth_time TEXT,
        birth_place TEXT,
        last_query TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Database tables ready.');
  } catch (err) {
    console.error('❌ DB Init Error:', err);
  } finally {
    client.release();
  }
}

// --- Baileys Auth State Functions ---

async function loadSession(sessionId) {
  try {
    const res = await pool.query('SELECT creds_json FROM whatsapp_sessions WHERE session_id = $1', [sessionId]);
    if (res.rows.length > 0) {
      return JSON.parse(res.rows[0].creds_json);
    }
    return null;
  } catch (err) {
    console.error('Error loading session:', err);
    return null;
  }
}

async function saveSession(sessionId, creds) {
  try {
    const credsJson = JSON.stringify(creds);
    await pool.query(
      `INSERT INTO whatsapp_sessions (session_id, creds_json) 
       VALUES ($1, $2) 
       ON CONFLICT (session_id) DO UPDATE SET creds_json = $2, updated_at = NOW()`,
      [sessionId, credsJson]
    );
  } catch (err) {
    console.error('Error saving session:', err);
  }
}

module.exports = { initDB, pool, loadSession, saveSession };