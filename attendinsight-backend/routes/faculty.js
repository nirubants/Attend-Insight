// routes/faculty.js
const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/faculty/dashboard
router.get('/dashboard', requireRole('faculty'), async (req, res) => {
  const facultyId = req.session.user.id;

  try {
    // Get courses taught by this faculty
    const coursesResult = await db.query('SELECT * FROM courses WHERE faculty_id = $1', [facultyId]);
    const courses = coursesResult.rows;
    const courseIds = courses.map(c => c.id);

    if (courseIds.length === 0) {
      return res.json({
        engagementIndex: 0,
        highRiskCount: 0,
        avgAttendance: 0,
        totalStudents: 0,
        alerts: [],
        trendData: { labels: [], attendance: [], engagement: [] }
      });
    }

    const placeholders = courseIds.map((_, i) => `$${i + 1}`).join(',');

    // High risk count
    const highRisk = await db.query(`
      SELECT COUNT(DISTINCT student_id) as cnt FROM engagement_scores
      WHERE course_id IN (${placeholders}) AND risk_level = 'High Risk'
    `, courseIds);

    // Average attendance rate
    const avgAtt = await db.query(`
      SELECT ROUND(AVG(attendance_rate), 1) as avg FROM engagement_scores
      WHERE course_id IN (${placeholders})
    `, courseIds);

    // Engagement index (average score)
    const engIdx = await db.query(`
      SELECT ROUND(AVG(score), 0) as avg FROM engagement_scores
      WHERE course_id IN (${placeholders})
    `, courseIds);

    // Total enrolled students
    const totalStudents = await db.query(`
      SELECT COUNT(DISTINCT student_id) as cnt FROM enrollments
      WHERE course_id IN (${placeholders})
    `, courseIds);

    // Recent unread alerts for faculty's courses
    const alerts = await db.query(`
      SELECT a.*, u.name as student_name, c.code as course_code
      FROM alerts a
      LEFT JOIN users u ON a.student_id = u.id
      LEFT JOIN courses c ON a.course_id = c.id
      WHERE a.course_id IN (${placeholders}) AND a.is_read = 0
      ORDER BY a.created_at DESC LIMIT 10
    `, courseIds);

    return res.json({
      engagementIndex: parseFloat(engIdx.rows[0].avg) || 0,
      highRiskCount: parseInt(highRisk.rows[0].cnt) || 0,
      avgAttendance: parseFloat(avgAtt.rows[0].avg) || 0,
      totalStudents: parseInt(totalStudents.rows[0].cnt) || 0,
      alerts: alerts.rows,
      trendData: {
        labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
        attendance: [0, 0, 0, 0, 0, parseFloat(avgAtt.rows[0].avg) || 0],
        engagement: [0, 0, 0, 0, 0, parseFloat(engIdx.rows[0].avg) || 0]
      }
    });
  } catch (err) {
    console.error('Faculty dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

// GET /api/faculty/courses
router.get('/courses', requireRole('faculty'), async (req, res) => {
  const facultyId = req.session.user.id;
  try {
    const result = await db.query('SELECT * FROM courses WHERE faculty_id = $1 ORDER BY code ASC', [facultyId]);
    res.json({ courses: result.rows });
  } catch (err) {
    console.error('Fetch faculty courses error:', err);
    res.status(500).json({ error: 'Failed to fetch courses.' });
  }
});

// GET /api/faculty/students?courseId=1
router.get('/students', requireRole('faculty'), async (req, res) => {
  const facultyId = req.session.user.id;
  const { courseId } = req.query;

  try {
    let sql = `
      SELECT u.id, u.name, u.email,
             COALESCE(es.attendance_rate, 0) as attendance_rate,
             COALESCE(es.score, 0) as score,
             COALESCE(es.risk_level, 'Low Risk') as risk_level,
             c.code as course_code, c.id as course_id,
             (SELECT COUNT(*) FROM attendance_records ar 
              JOIN attendance_sessions ats ON ar.session_id = ats.id 
              WHERE ar.student_id = u.id AND ats.course_id = c.id AND ats.status = 'closed') as attended_count,
             (SELECT COUNT(*) FROM attendance_sessions ats 
              WHERE ats.course_id = c.id AND ats.status = 'closed') as total_sessions
      FROM enrollments e
      JOIN users u ON e.student_id = u.id
      JOIN courses c ON e.course_id = c.id
      LEFT JOIN engagement_scores es ON es.student_id = u.id AND es.course_id = c.id
      WHERE c.faculty_id = $1
    `;
    const params = [facultyId];

    if (courseId && courseId !== 'all') {
      sql += ' AND c.id = $2';
      params.push(courseId);
    }

    sql += ' ORDER BY u.name ASC, c.code ASC';

    const result = await db.query(sql, params);
    return res.json({ students: result.rows });
  } catch (err) {
    console.error('Faculty students error:', err);
    res.status(500).json({ error: 'Failed to fetch students.' });
  }
});

// GET /api/faculty/alerts
router.get('/alerts', requireRole('faculty'), async (req, res) => {
  const facultyId = req.session.user.id;
  try {
    const coursesResult = await db.query('SELECT id FROM courses WHERE faculty_id = $1', [facultyId]);
    const courseIds = coursesResult.rows.map(c => c.id);

    if (courseIds.length === 0) return res.json({ alerts: [] });

    const placeholders = courseIds.map((_, i) => `$${i + 1}`).join(',');
    const alerts = await db.query(`
      SELECT a.*, u.name as student_name, c.code as course_code
      FROM alerts a
      LEFT JOIN users u ON a.student_id = u.id
      LEFT JOIN courses c ON a.course_id = c.id
      WHERE a.course_id IN (${placeholders})
      ORDER BY a.created_at DESC LIMIT 20
    `, courseIds);

    return res.json({ alerts: alerts.rows });
  } catch (err) {
    console.error('Faculty alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch alerts.' });
  }
});

// GET /api/faculty/student/:id/history
router.get('/student/:id/history', requireRole('faculty'), async (req, res) => {
  const studentId = req.params.id;
  try {
    const history = await db.query(`
      SELECT ar.*, ats.created_at as session_date, c.code as course_code
      FROM attendance_records ar
      JOIN attendance_sessions ats ON ar.session_id = ats.id
      JOIN courses c ON ats.course_id = c.id
      WHERE ar.student_id = $1
      ORDER BY ats.created_at DESC
    `, [studentId]);
    return res.json({ history: history.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

module.exports = router;
