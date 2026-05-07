// seed.js - Populate database with initial data
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./db');

async function seed() {
  console.log('🌱 Seeding AttendInsight database...\n');
  
  await db.initDB();

  const SALT_ROUNDS = 10;
  const DEFAULT_PASSWORD = 'password123';
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  try {
    // ─── Clear existing data (in dependency order) ───────────────────────────
    await db.query('DELETE FROM alerts');
    await db.query('DELETE FROM interventions');
    await db.query('DELETE FROM engagement_scores');
    await db.query('DELETE FROM attendance_records');
    await db.query('DELETE FROM attendance_sessions');
    await db.query('DELETE FROM enrollments');
    await db.query('DELETE FROM courses');
    await db.query('DELETE FROM users');

    console.log('✅ Cleared existing data');

    // ─── Insert Staff Users ───────────────────────────────────────────────────
    const insertUserSql = `
      INSERT INTO users (name, email, password_hash, role, status, mfa_enabled, department)
      VALUES ($1, $2, $3, $4, 'Active', $5, $6)
      RETURNING id
    `;

    const resFaculty = await db.query(insertUserSql, ['Dr. John Smith', 'faculty@univ.edu', hash, 'faculty', 1, 'Computer Science']);
    const resAdvisor = await db.query(insertUserSql, ['Jane Doe', 'advisor@univ.edu', hash, 'advisor', 1, 'Academic Affairs']);
    const resAdmin   = await db.query(insertUserSql, ['Admin User', 'admin@univ.edu', hash, 'admin', 1, 'Administration']);
    const resItAdmin = await db.query(insertUserSql, ['Grace Hopper', 'itadmin@univ.edu', hash, 'itadmin', 1, 'Information Technology']);

    const facultyId = resFaculty.rows[0].id;
    const advisorId = resAdvisor.rows[0].id;
    const adminId   = resAdmin.rows[0].id;
    const itAdminId = resItAdmin.rows[0].id;

    console.log('✅ Inserted staff users (faculty, advisor, admin, itadmin)');

    // ─── Insert 5 Students ────────────────────────────────────────────────────
    const resSarah   = await db.query(insertUserSql, ['Sarah Jenkins',  'sarah@univ.edu',   hash, 'student', 0, 'Computer Science']);
    const resMichael = await db.query(insertUserSql, ['Michael Chen',   'michael@univ.edu', hash, 'student', 0, 'Computer Science']);
    const resEmily   = await db.query(insertUserSql, ['Emily Davis',    'emily@univ.edu',   hash, 'student', 1, 'Mathematics']);
    const resDavid   = await db.query(insertUserSql, ['David Wilson',   'david@univ.edu',   hash, 'student', 1, 'Mathematics']);
    const resJames   = await db.query(insertUserSql, ['James Brown',    'james@univ.edu',   hash, 'student', 0, 'Business']);

    const studentIds = [
      resSarah.rows[0].id, 
      resMichael.rows[0].id, 
      resEmily.rows[0].id, 
      resDavid.rows[0].id, 
      resJames.rows[0].id
    ];
    console.log('✅ Inserted 5 students');

    // ─── Insert 2 Courses ────────────────────────────────────────────────────
    const resCS101 = await db.query(`
      INSERT INTO courses (code, name, faculty_id, department, semester)
      VALUES ('CS101', 'Introduction to Computer Science', $1, 'Computer Science', 'Fall 2026')
      RETURNING id
    `, [facultyId]);

    const resMath202 = await db.query(`
      INSERT INTO courses (code, name, faculty_id, department, semester)
      VALUES ('MATH202', 'Calculus II', $1, 'Mathematics', 'Fall 2026')
      RETURNING id
    `, [facultyId]);

    const cs101Id = resCS101.rows[0].id;
    const math202Id = resMath202.rows[0].id;
    console.log('✅ Inserted courses: CS101, MATH202');

    // ─── Enroll All Students in CS101; some in MATH202 ───────────────────────
    const enrollSql = 'INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)';
    for (const sid of studentIds) {
      await db.query(enrollSql, [sid, cs101Id]);
    }
    for (const sid of [resSarah.rows[0].id, resMichael.rows[0].id, resEmily.rows[0].id]) {
      await db.query(enrollSql, [sid, math202Id]);
    }
    console.log('✅ Enrolled students in courses');

    // ─── Create 6 Attendance Sessions (closed) for CS101 ─────────────────────
    const insertSessionSql = `
      INSERT INTO attendance_sessions (course_id, faculty_id, otp, status, created_at, closed_at)
      VALUES ($1, $2, $3, 'closed', $4, $5)
      RETURNING id
    `;

    const baseDates = [
      ['2026-04-01 09:00:00', '2026-04-01 09:50:00'],
      ['2026-04-03 09:00:00', '2026-04-03 09:50:00'],
      ['2026-04-07 09:00:00', '2026-04-07 09:50:00'],
      ['2026-04-10 09:00:00', '2026-04-10 09:50:00'],
      ['2026-04-14 09:00:00', '2026-04-14 09:50:00'],
      ['2026-04-17 09:00:00', '2026-04-17 09:50:00'],
    ];

    const sessionIds = [];
    for (let i = 0; i < baseDates.length; i++) {
      const [created, closed] = baseDates[i];
      const res = await db.query(insertSessionSql, [cs101Id, facultyId, String(1000 + i), created, closed]);
      sessionIds.push(res.rows[0].id);
    }
    console.log('✅ Created 6 closed attendance sessions for CS101');

    // ─── Attendance Records (simulate different rates per student) ────────────
    const presenceMap = {
      [resSarah.rows[0].id]:   [0, 1, 0, 0, 1, 0],
      [resMichael.rows[0].id]: [1, 1, 1, 1, 0, 1],
      [resEmily.rows[0].id]:   [1, 0, 1, 1, 0, 1],
      [resDavid.rows[0].id]:   [1, 1, 1, 1, 1, 1],
      [resJames.rows[0].id]:   [0, 0, 1, 0, 0, 0],
    };

    const insertRecordSql = 'INSERT INTO attendance_records (session_id, student_id) VALUES ($1, $2)';
    for (const sid of studentIds) {
      const presence = presenceMap[sid];
      for (let i = 0; i < sessionIds.length; i++) {
        if (presence[i]) {
          await db.query(insertRecordSql, [sessionIds[i], sid]);
        }
      }
    }
    console.log('✅ Inserted attendance records');

    // ─── Compute Engagement Scores ────────────────────────────────────────────
    const { recalcEngagement } = require('./utils/engagement');
    for (const sid of studentIds) {
      await recalcEngagement(sid, cs101Id);
    }

    // Sarah & Michael also enrolled in MATH202 — seed a score
    const sarahId = resSarah.rows[0].id;
    const michaelId = resMichael.rows[0].id;
    const emilyId = resEmily.rows[0].id;

    const upsertScoreSql = `
      INSERT INTO engagement_scores (student_id, course_id, attendance_rate, score, risk_level)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (student_id, course_id) DO UPDATE SET
        attendance_rate = EXCLUDED.attendance_rate,
        score = EXCLUDED.score,
        risk_level = EXCLUDED.risk_level
    `;

    await db.query(upsertScoreSql, [sarahId, math202Id, 50, 38, 'High Risk']);
    await db.query(upsertScoreSql, [michaelId, math202Id, 90, 88, 'Low Risk']);
    await db.query(upsertScoreSql, [emilyId, math202Id, 70, 72, 'Moderate Risk']);
    
    console.log('✅ Calculated engagement scores');

    // ─── Seed Alerts ──────────────────────────────────────────────────────────
    const insertAlertSql = `
      INSERT INTO alerts (student_id, course_id, alert_type, message, severity, is_read)
      VALUES ($1, $2, $3, $4, $5, 0)
    `;
    await db.query(insertAlertSql, [sarahId, cs101Id, 'high_risk', 'Sarah Jenkins sudden attendance drop (3 consecutive absences).', 'High']);
    await db.query(insertAlertSql, [resJames.rows[0].id, cs101Id, 'high_risk', 'James Brown attendance critically low (17%) in CS101.', 'High']);
    await db.query(insertAlertSql, [emilyId, cs101Id, 'engagement', 'Engagement anomaly detected for Emily Davis in CS101.', 'Moderate']);

    console.log('✅ Created alerts');

    // ─── Seed Interventions ───────────────────────────────────────────────────
    const insertInterventionSql = `
      INSERT INTO interventions (student_id, advisor_id, intervention_type, notes, status, follow_up_date)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    await db.query(insertInterventionSql, [sarahId, advisorId, 'Meeting', 'Discussed academic performance and attendance issues. Student agreed to improve.', 'Open', '2026-05-10']);
    await db.query(insertInterventionSql, [resJames.rows[0].id, advisorId, 'Email', 'Sent follow-up email regarding missing CS101 sessions.', 'In Progress', '2026-05-12']);
    await db.query(insertInterventionSql, [emilyId, advisorId, 'Academic Support', 'Referred to tutoring center for Calculus II.', 'Resolved', '2026-04-20']);

    console.log('✅ Seeded interventions');

    console.log('\n🎉 Seed complete!\n');
    console.log('─────────────────────────────────────────');
    console.log('  LOGIN CREDENTIALS (password: password123)');
    console.log('─────────────────────────────────────────');
    console.log('  Faculty:  faculty@univ.edu');
    console.log('  Advisor:  advisor@univ.edu');
    console.log('  Admin:    admin@univ.edu');
    console.log('  IT Admin: itadmin@univ.edu');
    console.log('─────────────────────────────────────────\n');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
}

seed();
