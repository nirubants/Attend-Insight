// utils/engagement.js - Engagement score calculation logic
const db = require('../db');

/**
 * Recalculate and store engagement score for a student in a course.
 */
async function recalcEngagement(studentId, courseId) {
  try {
    // Count total closed sessions for this course
    const sessionsRes = await db.query(`
      SELECT COUNT(*) as cnt FROM attendance_sessions
      WHERE course_id = $1 AND status = 'closed'
    `, [courseId]);
    const totalSessions = parseInt(sessionsRes.rows[0].cnt);

    // Count sessions where student was present
    const presentRes = await db.query(`
      SELECT COUNT(*) as cnt FROM attendance_records ar
      JOIN attendance_sessions ats ON ar.session_id = ats.id
      WHERE ar.student_id = $1 AND ats.course_id = $2 AND ats.status = 'closed'
    `, [studentId, courseId]);
    const present = parseInt(presentRes.rows[0].cnt);

    let attendanceRate = totalSessions > 0 ? (present / totalSessions) * 100 : 100;
    let riskLevel, score;

    if (attendanceRate >= 80) {
      riskLevel = 'Low Risk';
      score = Math.round(80 + (attendanceRate - 80) * 1.0);
      if (score > 100) score = 100;
    } else if (attendanceRate >= 60) {
      riskLevel = 'Moderate Risk';
      score = Math.round(50 + (attendanceRate - 60) * 1.5);
    } else {
      riskLevel = 'High Risk';
      score = Math.round(Math.max(5, attendanceRate * 0.75));
    }

    // Upsert engagement score
    await db.query(`
      INSERT INTO engagement_scores (student_id, course_id, attendance_rate, score, risk_level, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT(student_id, course_id) DO UPDATE SET
        attendance_rate = EXCLUDED.attendance_rate,
        score = EXCLUDED.score,
        risk_level = EXCLUDED.risk_level,
        updated_at = CURRENT_TIMESTAMP
    `, [studentId, courseId, Math.round(attendanceRate), score, riskLevel]);

    // Trigger High Risk alert if needed
    if (riskLevel === 'High Risk') {
      const studentRes = await db.query('SELECT name FROM users WHERE id = $1', [studentId]);
      const courseRes = await db.query('SELECT code FROM courses WHERE id = $1', [courseId]);
      
      const existingAlert = await db.query(`
        SELECT id FROM alerts
        WHERE student_id = $1 AND course_id = $2 AND alert_type = 'high_risk' AND is_read = 0
      `, [studentId, courseId]);

      if (existingAlert.rowCount === 0 && studentRes.rowCount > 0 && courseRes.rowCount > 0) {
        await db.query(`
          INSERT INTO alerts (student_id, course_id, alert_type, message, severity)
          VALUES ($1, $2, 'high_risk', $3, 'High')
        `, [studentId, courseId,
          `${studentRes.rows[0].name} has dropped to High Risk in ${courseRes.rows[0].code} (Attendance: ${Math.round(attendanceRate)}%)`
        ]);
      }
    }

    return { attendanceRate: Math.round(attendanceRate), score, riskLevel };
  } catch (err) {
    console.error('Recalc engagement error:', err);
  }
}

/**
 * Recalculate engagement for all students in a course
 */
async function recalcCourseEngagement(courseId) {
  try {
    const studentsRes = await db.query(`
      SELECT student_id FROM enrollments WHERE course_id = $1
    `, [courseId]);
    
    for (const row of studentsRes.rows) {
      await recalcEngagement(row.student_id, courseId);
    }
  } catch (err) {
    console.error('Recalc course engagement error:', err);
  }
}

module.exports = { recalcEngagement, recalcCourseEngagement };
