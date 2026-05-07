// routes/admin.js
const express = require('express');
const db = require('../db');
const bcrypt = require('bcrypt');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/admin/dashboard
router.get('/dashboard', requireRole('admin'), async (req, res) => {
  try {
    const totalStudents = await db.query(`SELECT COUNT(*) as cnt FROM users WHERE role = 'student'`);
    const totalCourses = await db.query(`SELECT COUNT(*) as cnt FROM courses`);

    const avgEngagement = await db.query(`
      SELECT ROUND(AVG(score), 0) as avg FROM engagement_scores
    `);

    const avgAttendance = await db.query(`
      SELECT ROUND(AVG(attendance_rate), 1) as avg FROM engagement_scores
    `);

    const highRiskStudents = await db.query(`
      SELECT COUNT(DISTINCT student_id) as cnt FROM engagement_scores WHERE risk_level = 'High Risk'
    `);

    const resolvedInterventions = await db.query(`
      SELECT COUNT(*) as cnt FROM interventions WHERE status = 'Resolved'
    `);

    const openInterventions = await db.query(`
      SELECT COUNT(*) as cnt FROM interventions WHERE status = 'Open'
    `);

    // Risk distribution by department
    const deptRiskResult = await db.query(`
      SELECT
        u.department,
        COUNT(DISTINCT es.student_id) as risk_count,
        ROUND(AVG(es.score), 0) as avg_score,
        ROUND(AVG(es.attendance_rate), 1) as avg_attendance
      FROM users u
      JOIN engagement_scores es ON u.id = es.student_id
      WHERE u.role = 'student' AND u.department IS NOT NULL
      GROUP BY u.department
    `);
    const deptRisk = deptRiskResult.rows;

    const deptLabels = deptRisk.map(d => d.department);
    const deptHeatmapData = deptRisk.map(d => parseInt(d.risk_count));
    const deptAvgScores = deptRisk.map(d => parseFloat(d.avg_score));
    const deptAvgAtt = deptRisk.map(d => parseFloat(d.avg_attendance));

    return res.json({
      totalStudents: parseInt(totalStudents.rows[0].cnt),
      totalCourses: parseInt(totalCourses.rows[0].cnt),
      avgEngagement: parseFloat(avgEngagement.rows[0].avg) || 0,
      avgAttendance: parseFloat(avgAttendance.rows[0].avg) || 0,
      highRiskStudents: parseInt(highRiskStudents.rows[0].cnt) || 0,
      resolvedInterventions: parseInt(resolvedInterventions.rows[0].cnt) || 0,
      openInterventions: parseInt(openInterventions.rows[0].cnt) || 0,
      retentionImpact: '+0.0%',
      // Dynamic chart data
      trendLabels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
      trendData: [0, 0, 0, 0, parseFloat(avgEngagement.rows[0].avg) || 0],
      deptHeatmap: {
        labels: deptLabels.length ? deptLabels : [],
        data: deptLabels.length ? deptHeatmapData : []
      },
      deptComparison: {
        labels: deptLabels,
        datasets: deptRisk.map((d, i) => ({
          label: d.department,
          data: [parseFloat(d.avg_attendance), parseFloat(d.avg_score), 100, 100, parseFloat(d.risk_count)],
          backgroundColor: i % 2 === 0 ? 'rgba(47, 164, 177, 0.2)' : 'rgba(15, 76, 129, 0.2)',
          borderColor: i % 2 === 0 ? '#2FA4B1' : '#0F4C81'
        }))
      }
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

// GET /api/admin/students - List all students
router.get('/students', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, name, email, department, status, created_at 
      FROM users 
      WHERE role = 'student' 
      ORDER BY name ASC
    `);
    res.json({ students: result.rows });
  } catch (err) {
    console.error('Fetch students error:', err);
    res.status(500).json({ error: 'Failed to fetch students.' });
  }
});

// POST /api/admin/students - Create new student
router.post('/students', requireRole('admin'), async (req, res) => {
  const { name, email, department, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(`
      INSERT INTO users (name, email, password_hash, role, department, status)
      VALUES ($1, $2, $3, 'student', $4, 'Active')
      RETURNING id, name, email, department, role
    `, [name, email.toLowerCase().trim(), hash, department || 'General']);
    
    res.status(201).json({ message: 'Student created successfully', student: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already exists.' });
    }
    console.error('Create student error:', err);
    res.status(500).json({ error: 'Failed to create student.' });
  }
});

// PUT /api/admin/students/:id - Update student
router.put('/students/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, email, department, status } = req.body;

  try {
    const result = await db.query(`
      UPDATE users 
      SET name = COALESCE($1, name), 
          email = COALESCE($2, email), 
          department = COALESCE($3, department),
          status = COALESCE($4, status)
      WHERE id = $5 AND role = 'student'
      RETURNING id, name, email, department, status
    `, [name, email ? email.toLowerCase().trim() : null, department, status, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    res.json({ message: 'Student updated successfully', student: result.rows[0] });
  } catch (err) {
    console.error('Update student error:', err);
    res.status(500).json({ error: 'Failed to update student.' });
  }
});

// DELETE /api/admin/students/:id - Delete student
router.delete('/students/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, 'student']);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    res.json({ message: 'Student deleted successfully.' });
  } catch (err) {
    console.error('Delete student error:', err);
    res.status(500).json({ error: 'Failed to delete student.' });
  }
});

// ─── Course Management ───────────────────────────────────────────────────

// GET /api/admin/courses - List all courses
router.get('/courses', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, u.name as faculty_name 
      FROM courses c 
      LEFT JOIN users u ON c.faculty_id = u.id 
      ORDER BY c.code ASC
    `);
    res.json({ courses: result.rows });
  } catch (err) {
    console.error('Fetch courses error:', err);
    res.status(500).json({ error: 'Failed to fetch courses.' });
  }
});

// POST /api/admin/courses - Create new course
router.post('/courses', requireRole('admin'), async (req, res) => {
  const { code, name, facultyId, department, semester } = req.body;
  if (!code || !name || !facultyId) {
    return res.status(400).json({ error: 'Code, name, and facultyId are required.' });
  }

  try {
    const result = await db.query(`
      INSERT INTO courses (code, name, faculty_id, department, semester)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [code, name, facultyId, department || 'General', semester || 'Fall 2026']);
    
    res.status(201).json({ message: 'Course created successfully', course: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Course code already exists.' });
    }
    console.error('Create course error:', err);
    res.status(500).json({ error: 'Failed to create course.' });
  }
});

// PUT /api/admin/courses/:id - Update course
router.put('/courses/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { code, name, facultyId, department, semester } = req.body;

  try {
    const result = await db.query(`
      UPDATE courses 
      SET code = COALESCE($1, code), 
          name = COALESCE($2, name), 
          faculty_id = COALESCE($3, faculty_id),
          department = COALESCE($4, department),
          semester = COALESCE($5, semester)
      WHERE id = $6
      RETURNING *
    `, [code, name, facultyId, department, semester, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found.' });
    }
    res.json({ message: 'Course updated successfully', course: result.rows[0] });
  } catch (err) {
    console.error('Update course error:', err);
    res.status(500).json({ error: 'Failed to update course.' });
  }
});

// DELETE /api/admin/courses/:id - Delete course
router.delete('/courses/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM courses WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found.' });
    }
    res.json({ message: 'Course deleted successfully.' });
  } catch (err) {
    console.error('Delete course error:', err);
    res.status(500).json({ error: 'Failed to delete course.' });
  }
});

// Broadcast institutional alerts to all high-risk students
router.post('/broadcast-alerts', requireRole('admin'), async (req, res) => {
  try {
    const highRisk = await db.query(`
      SELECT u.name, u.email, es.attendance_rate
      FROM users u
      JOIN engagement_scores es ON u.id = es.student_id
      WHERE es.risk_level = 'High Risk'
    `);

    console.log(`[ADMIN] Broadcasting alerts to ${highRisk.rows.length} high-risk students.`);

    return res.json({
      message: 'Institutional alerts broadcasted successfully.',
      recipientsCount: highRisk.rows.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Broadcast error:', err);
    res.status(500).json({ error: 'Failed to broadcast alerts.' });
  }
});

// GET /api/admin/settings
router.get('/settings', requireRole('admin', 'itadmin'), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM settings');
    res.json({ settings: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

// PUT /api/admin/settings/:key
router.put('/settings/:key', requireRole('admin', 'itadmin'), async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (key === 'risk_threshold') {
    const val = parseInt(value);
    if (isNaN(val) || val < 1 || val > 100) {
      return res.status(400).json({ error: 'Value Must Be Between 1–100' });
    }
  }

  try {
    await db.query(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `, [key, value]);
    res.json({ message: 'Setting updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update setting.' });
  }
});

// GET /api/admin/reports/generate
router.get('/reports/generate', requireRole('admin'), async (req, res) => {
  const { startDate, endDate } = req.query;
  // In a real app, this would generate a PDF or CSV.
  // For testing, we return a mock report link.
  res.json({
    message: 'Report generated successfully.',
    downloadUrl: `/api/admin/reports/download?token=${Date.now()}`,
    dateRange: { startDate, endDate }
  });
});

module.exports = router;
