// routes/interventions.js
const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

// POST /api/interventions
router.post('/', requireRole('advisor'), async (req, res) => {
  const advisorId = req.session.user.id;
  const { studentId, interventionType, notes, followUpDate, status } = req.body;

  if (!studentId || !interventionType || !notes) {
    return res.status(400).json({ error: 'studentId, interventionType, and notes are required.' });
  }

  try {
    const studentResult = await db.query('SELECT id FROM users WHERE id = $1 AND role = $2', [studentId, 'student']);
    const student = studentResult.rows[0];
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const result = await db.query(`
      INSERT INTO interventions (student_id, advisor_id, intervention_type, notes, status, follow_up_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [studentId, advisorId, interventionType, notes || null, status || 'Open', followUpDate || null]);

    return res.status(201).json({
      message: 'Intervention logged successfully.',
      interventionId: result.rows[0].id
    });
  } catch (err) {
    console.error('Create intervention error:', err);
    res.status(500).json({ error: 'Failed to create intervention.' });
  }
});

// GET /api/interventions
router.get('/', requireRole('advisor'), async (req, res) => {
  const { studentId } = req.query;
  try {
    let sql = `
      SELECT i.*, u.name as student_name, a.name as advisor_name
      FROM interventions i
      JOIN users u ON i.student_id = u.id
      JOIN users a ON i.advisor_id = a.id
    `;
    const params = [];

    if (studentId) {
      sql += ' WHERE i.student_id = $1';
      params.push(studentId);
    }
    sql += ' ORDER BY i.created_at DESC';

    const interventions = await db.query(sql, params);
    return res.json({ interventions: interventions.rows });
  } catch (err) {
    console.error('Fetch interventions error:', err);
    res.status(500).json({ error: 'Failed to fetch interventions.' });
  }
});

// PUT /api/interventions/:id
router.put('/:id', requireRole('advisor'), async (req, res) => {
  const { status, notes, followUpDate } = req.body;
  const { id } = req.params;

  try {
    await db.query(`
      UPDATE interventions SET status = COALESCE($1, status), notes = COALESCE($2, notes),
      follow_up_date = COALESCE($3, follow_up_date)
      WHERE id = $4
    `, [status || null, notes || null, followUpDate || null, id]);

    return res.json({ message: 'Intervention updated.' });
  } catch (err) {
    console.error('Update intervention error:', err);
    res.status(500).json({ error: 'Failed to update intervention.' });
  }
});

module.exports = router;
