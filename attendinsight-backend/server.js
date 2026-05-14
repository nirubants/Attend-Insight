// server.js - Main Express server entry point
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const db = require('./db');

async function createApp() {
  // Initialize DB (creates tables if not exists)
  await db.initDB();

  const app = express();
  
  // ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://attend-insight-new.onrender.com',
  ],
  credentials: true,
}));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session configuration
  app.use(session({
    secret: process.env.SESSION_SECRET || 'attendinsight_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000  // 8 hours
    }
  }));

  // ─── Serve Frontend Static Files ─────────────────────────────────────────────
  const frontendPath = path.join(__dirname, '..');
  app.use(express.static(frontendPath));

  // ─── API Routes ──────────────────────────────────────────────────────────────
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/faculty', require('./routes/faculty'));
  app.use('/api/sessions', require('./routes/sessions'));
  app.use('/api/advisor', require('./routes/advisor'));
  app.use('/api/interventions', require('./routes/interventions'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/itadmin', require('./routes/itadmin'));

  // ─── Health Check ────────────────────────────────────────────────────────────
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── Catch-all: serve frontend pages ─────────────────────────────────────────
  app.get('*.html', (req, res) => {
    const htmlFile = path.join(frontendPath, req.path);
    res.sendFile(htmlFile, err => {
      if (err) res.status(404).send('Page not found');
    });
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'login.html'));
  });

  // ─── Global Error Handler ─────────────────────────────────────────────────────
  app.use((err, req, res, next) => {
    console.error('[ERROR]', err.stack || err.message);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

if (require.main === module) {
  createApp().then(app => {
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
      console.log(`\n🚀 AttendInsight Backend running at http://localhost:${PORT}`);
      console.log(`📂 Frontend served from: ${path.join(__dirname, '..')}`);
      console.log(`🗄️  Database: PostgreSQL (Connected)`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`\n⚠️  PORT ${PORT} IS ALREADY IN USE!`);
        process.exit(0);
      } else {
        console.error('[SERVER ERROR]', err);
        process.exit(1);
      }
    });
  }).catch(err => {
    console.error('❌ Failed to start application:', err);
    process.exit(1);
  });
}

module.exports = { createApp };
