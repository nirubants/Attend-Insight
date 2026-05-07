// routes/advisor.js
const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/advisor/dashboard
router.get('/dashboard', requireRole('advisor'), async (req, res) => {
  try {
    const totalAtRisk = await db.query(`
      SELECT COUNT(DISTINCT student_id) as cnt FROM engagement_scores
      WHERE risk_level IN ('High Risk','Moderate Risk')
    `);

    const highRisk = await db.query(`
      SELECT COUNT(DISTINCT student_id) as cnt FROM engagement_scores
      WHERE risk_level = 'High Risk'
    `);

    const openInterventions = await db.query(`
      SELECT COUNT(*) as cnt FROM interventions WHERE status = 'Open'
    `);

    const resolvedCases = await db.query(`
      SELECT COUNT(*) as cnt FROM interventions WHERE status = 'Resolved'
    `);

    const engagementIndex = await db.query(`
      SELECT ROUND(AVG(score), 0) as avg FROM engagement_scores
    `);

    // Intervention chart data grouped by month
    const interventionData = await db.query(`
      SELECT
        TO_CHAR(created_at, 'MM') as month,
        status,
        COUNT(*) as cnt
      FROM interventions
      GROUP BY month, status
      ORDER BY month
    `);

    return res.json({
      totalAtRisk: parseInt(totalAtRisk.rows[0].cnt) || 0,
      highRisk: parseInt(highRisk.rows[0].cnt) || 0,
      openInterventions: parseInt(openInterventions.rows[0].cnt) || 0,
      resolvedCases: parseInt(resolvedCases.rows[0].cnt) || 0,
      engagementIndex: parseFloat(engagementIndex.rows[0].avg) || 0,
      interventionData: interventionData.rows
    });
  } catch (err) {
    console.error('Advisor dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

// GET /api/advisor/at-risk
router.get('/at-risk', requireRole('advisor'), async (req, res) => {
  try {
    const students = await db.query(`
      SELECT
        u.id, u.name, u.email,
        es.attendance_rate,
        es.score,
        es.risk_level,
        c.code as course_code,
        c.id as course_id,
        (SELECT COUNT(*) FROM interventions i WHERE i.student_id = u.id AND i.status = 'Open') as open_interventions,
        (SELECT i2.status FROM interventions i2 WHERE i2.student_id = u.id ORDER BY i2.created_at DESC LIMIT 1) as latest_status,
        (SELECT i3.follow_up_date FROM interventions i3 WHERE i3.student_id = u.id ORDER BY i3.created_at DESC LIMIT 1) as follow_up_date
      FROM engagement_scores es
      JOIN users u ON es.student_id = u.id
      JOIN courses c ON es.course_id = c.id
      WHERE es.risk_level IN ('High Risk','Moderate Risk')
      ORDER BY es.score ASC
    `);

    return res.json({ students: students.rows });
  } catch (err) {
    console.error('At-risk students error:', err);
    res.status(500).json({ error: 'Failed to fetch at-risk students.' });
  }
});

// GET /api/advisor/alerts
router.get('/alerts', requireRole('advisor'), async (req, res) => {
  try {
    const alerts = await db.query(`
      SELECT a.*, u.name as student_name, c.code as course_code
      FROM alerts a
      LEFT JOIN users u ON a.student_id = u.id
      LEFT JOIN courses c ON a.course_id = c.id
      WHERE a.severity = 'High' AND a.is_read = 0
      ORDER BY a.created_at DESC LIMIT 20
    `);

    return res.json({ alerts: alerts.rows });
  } catch (err) {
    console.error('Advisor alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch alerts.' });
  }
});

// GET /api/advisor/student/:id
router.get('/student/:id', requireRole('advisor', 'faculty', 'admin'), async (req, res) => {
  const studentId = req.params.id;
  try {
    const student = await db.query('SELECT * FROM users WHERE id = $1', [studentId]);
    const engagement = await db.query('SELECT AVG(score) as avg_score, AVG(attendance_rate) as avg_att FROM engagement_scores WHERE student_id = $1', [studentId]);
    
    return res.json({
      student: student.rows[0],
      engagementIndex: parseFloat(engagement.rows[0].avg_score) || 0,
      avgAttendance: parseFloat(engagement.rows[0].avg_att) || 0,
      engagementTrend: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr'],
        data: [0, 0, 0, parseFloat(engagement.rows[0].avg_score) || 0]
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch student profile.' });
  }
});

module.exports = router;
