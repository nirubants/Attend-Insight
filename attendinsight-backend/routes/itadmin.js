// routes/itadmin.js
const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// GET /api/itadmin/dashboard
router.get('/dashboard', requireRole('itadmin'), async (req, res) => {
  try {
    const totalUsers = await db.query('SELECT COUNT(*) as cnt FROM users');
    const activeUsers = await db.query(`SELECT COUNT(*) as cnt FROM users WHERE status = 'Active'`);
    const totalCourses = await db.query('SELECT COUNT(*) as cnt FROM courses');
    const totalSessions = await db.query('SELECT COUNT(*) as cnt FROM attendance_sessions');
    const mfaEnabled = await db.query('SELECT COUNT(*) as cnt FROM users WHERE mfa_enabled = 1');

    return res.json({
      systemUptime: '99.98%',
      activeSessions: parseInt(totalSessions.rows[0].cnt),
      lastSync: new Date().toISOString(),
      totalUsers: parseInt(totalUsers.rows[0].cnt),
      activeUsers: parseInt(activeUsers.rows[0].cnt),
      totalCourses: parseInt(totalCourses.rows[0].cnt),
      mfaEnabled: parseInt(mfaEnabled.rows[0].cnt)
    });
  } catch (err) {
    console.error('IT Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

// GET /api/itadmin/users
router.get('/users', requireRole('itadmin', 'admin'), async (req, res) => {
  const { search, role } = req.query;
  try {
    let sql = `SELECT id, name, email, role, status, mfa_enabled, created_at FROM users WHERE 1=1`;
    const params = [];

    if (search) {
      sql += ` AND (name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    if (role) {
      sql += ` AND role = $${params.length + 1}`;
      params.push(role);
    }

    sql += ' ORDER BY role, name';
    const result = await db.query(sql, params);
    return res.json({ users: result.rows });
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// POST /api/itadmin/users
router.post('/users', requireRole('itadmin'), async (req, res) => {
  const { name, email, role, status, mfaEnabled } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ error: 'name, email, and role are required.' });
  }
  const validRoles = ['faculty', 'advisor', 'admin', 'itadmin', 'student'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  try {
    const passwordHash = await bcrypt.hash('password123', 10);
    const result = await db.query(`
      INSERT INTO users (name, email, password_hash, role, status, mfa_enabled)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [name, email.toLowerCase().trim(), passwordHash, role, status || 'Active', mfaEnabled ? 1 : 0]);
    return res.status(201).json({ message: 'User created.', userId: result.rows[0].id });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Email already exists.' });
    }
    console.error('Create user error:', e);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// PUT /api/itadmin/users/:id
router.put('/users/:id', requireRole('itadmin'), async (req, res) => {
  const { name, email, role, status, mfaEnabled } = req.body;
  const { id } = req.params;

  try {
    const userResult = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userResult.rowCount === 0) return res.status(404).json({ error: 'User not found.' });

    await db.query(`
      UPDATE users SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        role = COALESCE($3, role),
        status = COALESCE($4, status),
        mfa_enabled = COALESCE($5, mfa_enabled)
      WHERE id = $6
    `, [
      name || null,
      email ? email.toLowerCase().trim() : null,
      role || null,
      status || null,
      mfaEnabled !== undefined ? (mfaEnabled ? 1 : 0) : null,
      id
    ]);

    return res.json({ message: 'User updated successfully.' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// GET /api/itadmin/sync/history
router.get('/sync/history', requireRole('itadmin'), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sync_logs ORDER BY synced_at DESC');
    res.json({ history: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sync history.' });
  }
});

// POST /api/itadmin/sync
router.post('/sync', requireRole('itadmin'), async (req, res) => {
  const isOffline = req.body.simulateOffline === true;
  if (isOffline) {
    await db.query(`
      INSERT INTO sync_logs (status, records_processed, message)
      VALUES ('error', 0, 'Connection Failed: LMS Offline')
    `);
    return res.status(503).json({ error: 'Connection Failed: LMS Offline' });
  }

  const processed = Math.floor(Math.random() * 500) + 100;
  try {
    await db.query(`
      INSERT INTO sync_logs (status, records_processed, message)
      VALUES ('success', $1, 'LMS sync completed successfully.')
    `, [processed]);

    return res.json({
      message: 'LMS sync completed successfully.',
      recordsProcessed: processed,
      status: 'success'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete sync.' });
  }
});

// ─── Role Management ─────────────────────────────────────────────────────────

// GET /api/itadmin/roles
router.get('/roles', requireRole('itadmin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, ARRAY_AGG(rp.permission) as permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      GROUP BY r.id
      ORDER BY r.name
    `);
    res.json({ roles: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch roles.' });
  }
});

// POST /api/itadmin/roles
router.post('/roles', requireRole('itadmin'), async (req, res) => {
  const { name, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'Role name is required.' });

  try {
    const result = await db.query('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    const roleId = result.rows[0].id;

    if (permissions && Array.isArray(permissions)) {
      for (const p of permissions) {
        await db.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [roleId, p]);
      }
    }
    res.status(201).json({ message: 'Role created.', roleId });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Role Name Already Exists' });
    res.status(500).json({ error: 'Failed to create role.' });
  }
});

// PUT /api/itadmin/roles/:id
router.put('/roles/:id', requireRole('itadmin'), async (req, res) => {
  const { id } = req.params;
  const { name, status, permissions } = req.body;

  try {
    if (status === 'Inactive') {
      const activeUsers = await db.query('SELECT COUNT(*) as cnt FROM users WHERE role = (SELECT name FROM roles WHERE id = $1) AND status = \'Active\'', [id]);
      if (parseInt(activeUsers.rows[0].cnt) > 0) {
        return res.status(400).json({ error: 'Cannot deactivate role with active users.' });
      }
    }

    await db.query(`
      UPDATE roles SET name = COALESCE($1, name), status = COALESCE($2, status)
      WHERE id = $3
    `, [name || null, status || null, id]);

    if (permissions && Array.isArray(permissions)) {
      await db.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
      for (const p of permissions) {
        await db.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [id, p]);
      }
    }
    res.json({ message: 'Role updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

module.exports = router;
