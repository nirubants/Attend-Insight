// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash); // ✅ correct
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };

// Then save session explicitly before responding:
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      return res.json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    });

  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out successfully.' });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return res.json({ user: req.session.user });
});

module.exports = router;
