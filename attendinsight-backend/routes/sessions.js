// routes/sessions.js - QR/OTP Attendance Sessions
const express = require('express');
const db = require('../db');
const QRCode = require('qrcode');
const { requireRole } = require('../middleware/auth');
const { recalcCourseEngagement } = require('../utils/engagement');
const router = express.Router();

// POST /api/sessions/create
router.post('/create', requireRole('faculty'), async (req, res) => {
  const { courseId } = req.body;
  const facultyId = req.session.user.id;

  if (!courseId) return res.status(400).json({ error: 'courseId is required.' });

  try {
    // Verify faculty owns this course
    const courseResult = await db.query('SELECT * FROM courses WHERE id = $1 AND faculty_id = $2', [courseId, facultyId]);
    const course = courseResult.rows[0];
    if (!course) return res.status(403).json({ error: 'Course not found or unauthorized.' });

    // Close any existing open session for this course
    await db.query(`
      UPDATE attendance_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE course_id = $1 AND faculty_id = $2 AND status = 'open'
    `, [courseId, facultyId]);

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    
    // Create QR Code URL (pointing to the attendance page)
    const baseUrl = process.env.BASE_URL || 'https://nirubants.github.io/Attend-Insight';
    const attendanceUrl = `${baseUrl}/attendance.html?courseId=${courseId}&otp=${otp}`;
    const qrImage = await QRCode.toDataURL(attendanceUrl);

    const result = await db.query(`
      INSERT INTO attendance_sessions (course_id, faculty_id, otp, qr_data, status)
      VALUES ($1, $2, $3, $4, 'open')
      RETURNING id
    `, [courseId, facultyId, otp, attendanceUrl]);

    return res.json({
      sessionId: result.rows[0].id,
      otp,
      qrImage, // Return the Data URL for the QR image
      courseCode: course.code,
      message: 'Session created successfully.'
    });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session.' });
  }
});

// PUBLIC POST /api/sessions/submit-public (student submits by Name and OTP)
router.post('/submit-public', async (req, res) => {
  const { name, otp, courseId } = req.body;

  if (!name || !otp || !courseId) {
    return res.status(400).json({ error: 'Name, OTP, and Course ID are required.' });
  }

  try {
    // Find open session
    const sessionResult = await db.query(`
      SELECT * FROM attendance_sessions
      WHERE course_id = $1 AND otp = $2 AND status = 'open'
    `, [courseId, String(otp)]);
    const session = sessionResult.rows[0];

    if (!session) return res.status(404).json({ error: 'Invalid OTP or session not open.' });

    // Enforce 3-minute limit
    const sessionAgeMs = Date.now() - new Date(session.created_at).getTime();
    if (sessionAgeMs > 3 * 60 * 1000) {
      await db.query("UPDATE attendance_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = $1", [session.id]);
      return res.status(410).json({ error: 'Session has expired.' });
    }

    // Find student by name
    const studentResult = await db.query('SELECT id FROM users WHERE LOWER(name) = $1 AND role = $2', [name.toLowerCase().trim(), 'student']);
    if (studentResult.rowCount === 0) {
      return res.status(404).json({ error: 'Student name not found in system.' });
    }
    const studentId = studentResult.rows[0].id;

    // Check enrollment
    const enrolled = await db.query('SELECT * FROM enrollments WHERE student_id = $1 AND course_id = $2', [studentId, courseId]);
    if (enrolled.rowCount === 0) return res.status(403).json({ error: 'You are not enrolled in this course.' });

    // Try to record attendance
    await db.query(`
      INSERT INTO attendance_records (session_id, student_id)
      VALUES ($1, $2)
    `, [session.id, studentId]);
    
    return res.json({ message: 'Attendance recorded successfully!' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Attendance already submitted for this session.' });
    }
    console.error('Submit public attendance error:', err);
    res.status(500).json({ error: 'Failed to submit attendance.' });
  }
});

// POST /api/sessions/submit  (authenticated student submits OTP)
router.post('/submit', requireRole('student'), async (req, res) => {
  const { otp, courseId } = req.body;
  const studentId = req.session.user.id;

  if (!otp || !courseId) return res.status(400).json({ error: 'otp and courseId are required.' });

  try {
    // Find open session
    const sessionResult = await db.query(`
      SELECT * FROM attendance_sessions
      WHERE course_id = $1 AND otp = $2 AND status = 'open'
    `, [courseId, String(otp)]);
    const session = sessionResult.rows[0];

    if (!session) return res.status(404).json({ error: 'Invalid OTP or session not open.' });

    // Enforce 3-minute limit
    const sessionAgeMs = Date.now() - new Date(session.created_at).getTime();
    if (sessionAgeMs > 3 * 60 * 1000) {
      await db.query("UPDATE attendance_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = $1", [session.id]);
      return res.status(410).json({ error: 'Session has expired.' });
    }

    // Check enrollment
    const enrolled = await db.query('SELECT * FROM enrollments WHERE student_id = $1 AND course_id = $2', [studentId, courseId]);
    if (enrolled.rowCount === 0) return res.status(403).json({ error: 'You are not enrolled in this course.' });

    // Try to record attendance
    await db.query(`
      INSERT INTO attendance_records (session_id, student_id)
      VALUES ($1, $2)
    `, [session.id, studentId]);
    
    return res.json({ message: 'Attendance recorded successfully.' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Attendance already submitted for this session.' });
    }
    console.error('Submit attendance error:', err);
    res.status(500).json({ error: 'Failed to submit attendance.' });
  }
});

// GET /api/sessions/:id/count  (live count polling)
router.get('/:id/count', requireRole('faculty'), async (req, res) => {
  const sessionId = req.params.id;
  try {
    const result = await db.query(`
      SELECT COUNT(*) as count FROM attendance_records WHERE session_id = $1
    `, [sessionId]);
    return res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('Count error:', err);
    res.status(500).json({ error: 'Failed to fetch count.' });
  }
});

// GET /api/sessions/:id/present-students (get list of student IDs present)
router.get('/:id/present-students', requireRole('faculty'), async (req, res) => {
  const sessionId = req.params.id;
  try {
    const result = await db.query(`
      SELECT student_id FROM attendance_records WHERE session_id = $1
    `, [sessionId]);
    return res.json({ studentIds: result.rows.map(r => r.student_id) });
  } catch (err) {
    console.error('Present students error:', err);
    res.status(500).json({ error: 'Failed to fetch present students.' });
  }
});

// POST /api/sessions/:id/close
router.post('/:id/close', requireRole('faculty'), async (req, res) => {
  const sessionId = req.params.id;
  const facultyId = req.session.user.id;

  try {
    const sessionResult = await db.query(`
      SELECT * FROM attendance_sessions WHERE id = $1 AND faculty_id = $2
    `, [sessionId, facultyId]);
    const session = sessionResult.rows[0];

    if (!session) return res.status(404).json({ error: 'Session not found.' });
    if (session.status === 'closed') return res.status(400).json({ error: 'Session already closed.' });

    await db.query(`
      UPDATE attendance_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [sessionId]);

    // Recalculate engagement for all students in this course
    await recalcCourseEngagement(session.course_id);

    const countResult = await db.query('SELECT COUNT(*) as count FROM attendance_records WHERE session_id = $1', [sessionId]);
    return res.json({ message: 'Session closed. Engagement scores updated.', totalPresent: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error('Close session error:', err);
    res.status(500).json({ error: 'Failed to close session.' });
  }
});

// GET /api/sessions/active?courseId=1
router.get('/active', requireRole('faculty'), async (req, res) => {
  const { courseId } = req.query;
  const facultyId = req.session.user.id;
  try {
    let sql = `SELECT * FROM attendance_sessions WHERE faculty_id = $1 AND status = 'open'`;
    const params = [facultyId];
    
    if (courseId && courseId !== 'all') {
      sql += ' AND course_id = $2';
      params.push(courseId);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT 1';
    const sessionResult = await db.query(sql, params);
    return res.json({ session: sessionResult.rows[0] || null });
  } catch (err) {
    console.error('Active session error:', err);
    res.status(500).json({ error: 'Failed to fetch active session.' });
  }
});

module.exports = router;
