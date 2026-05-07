const db = require('../db');
const bcrypt = require('bcrypt');
const { clearDatabase } = require('./utils');
const { recalcEngagement } = require('../utils/engagement');

async function seed() {
  console.log('🧹 Cleaning database...');
  await clearDatabase();

  const hp = await bcrypt.hash('password123', 10);

  console.log('👤 Seeding users...');
  const users = await Promise.all([
    db.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id", ['IT Admin', 'itadmin@univ.edu', hp, 'itadmin']),
    db.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id", ['Institutional Admin', 'admin@univ.edu', hp, 'admin']),
    db.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id", ['Advisor Sarah', 'advisor@univ.edu', hp, 'advisor']),
    db.query("INSERT INTO users (name, email, password_hash, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id", ['Dr. James Wilson', 'faculty@univ.edu', hp, 'faculty', 'Computer Science']),
    db.query("INSERT INTO users (name, email, password_hash, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id", ['Prof. Elena Rodriguez', 'faculty2@univ.edu', hp, 'faculty', 'Data Science']),
  ]);

  const itAdminId = users[0].rows[0].id;
  const adminId = users[1].rows[0].id;
  const advisorId = users[2].rows[0].id;
  const faculty1Id = users[3].rows[0].id;
  const faculty2Id = users[4].rows[0].id;

  const studentData = [
    { name: 'Alice Johnson', email: 'alice@univ.edu', attendance: 'high' },   // 10/10
    { name: 'Bob Smith', email: 'bob@univ.edu', attendance: 'mid' },        // 7/10
    { name: 'Charlie Davis', email: 'charlie@univ.edu', attendance: 'low' }, // 3/10
    { name: 'Diana Prince', email: 'diana@univ.edu', attendance: 'high' },
    { name: 'Ethan Hunt', email: 'ethan@univ.edu', attendance: 'mid' },
    { name: 'Fiona Gallagher', email: 'fiona@univ.edu', attendance: 'low' },
  ];

  const students = [];
  for (let i = 0; i < studentData.length; i++) {
    const s = studentData[i];
    const dept = i < 3 ? 'Computer Science' : 'Data Science';
    const res = await db.query("INSERT INTO users (name, email, password_hash, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id", [s.name, s.email, hp, 'student', dept]);
    students.push({ id: res.rows[0].id, dept, ...s });
  }

  console.log('📚 Seeding courses...');
  const courses = await Promise.all([
    db.query("INSERT INTO courses (code, name, faculty_id, department) VALUES ($1, $2, $3, $4) RETURNING id", ['CS101', 'Intro to Programming', faculty1Id, 'Computer Science']),
    db.query("INSERT INTO courses (code, name, faculty_id, department) VALUES ($1, $2, $3, $4) RETURNING id", ['CS102', 'Data Structures', faculty1Id, 'Computer Science']),
    db.query("INSERT INTO courses (code, name, faculty_id, department) VALUES ($1, $2, $3, $4) RETURNING id", ['DS201', 'Introduction to Data Science', faculty1Id, 'Data Science']),
    db.query("INSERT INTO courses (code, name, faculty_id, department) VALUES ($1, $2, $3, $4) RETURNING id", ['DS202', 'Machine Learning', faculty1Id, 'Data Science']),
  ]);

  const courseIds = courses.map(c => c.rows[0].id);

  console.log('🔗 Seeding enrollments and attendance...');
  for (const courseId of courseIds) {
    // Create 10 sessions for each course
    const sessions = [];
    for (let i = 1; i <= 10; i++) {
      const res = await db.query("INSERT INTO attendance_sessions (course_id, faculty_id, otp, status) VALUES ($1, $2, $3, $4) RETURNING id", [courseId, faculty1Id, `12345${i % 10}`, 'closed']);
      sessions.push(res.rows[0].id);
    }

    for (const student of students) {
      // Enroll student in course
      await db.query("INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [student.id, courseId]);

      // Add attendance records
      let count = 0;
      if (student.attendance === 'high') count = 10;
      else if (student.attendance === 'mid') count = 7;
      else if (student.attendance === 'low') count = 3;

      for (let j = 0; j < count; j++) {
        await db.query("INSERT INTO attendance_records (session_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [sessions[j], student.id]);
      }

      // Recalculate engagement for this student-course pair
      await recalcEngagement(student.id, courseId);
    }
  }

  console.log('⚠️ Seeding alerts and interventions...');
  // Add some manual alerts for low attendance students
  for (const student of students) {
    if (student.attendance === 'low') {
      await db.query("INSERT INTO alerts (student_id, alert_type, message, severity) VALUES ($1, $2, $3, $4)", [
        student.id, 'Low Attendance', `Critical: ${student.name} has dropped below 35% attendance.`, 'High'
      ]);
      await db.query("INSERT INTO interventions (student_id, advisor_id, intervention_type, notes, status) VALUES ($1, $2, $3, $4, $5)", [
        student.id, advisorId, 'Academic Probation', 'Scheduled a meeting to discuss poor attendance.', 'Open'
      ]);
    }
  }

  // Seed some sync logs
  await db.query("INSERT INTO sync_logs (status, records_processed, message) VALUES ('success', 1240, 'Nightly LMS sync completed.')");

  // Seed custom roles
  const roleRes = await db.query("INSERT INTO roles (name) VALUES ('department_head') RETURNING id");
  await db.query("INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'view_all_reports')", [roleRes.rows[0].id]);

  console.log('✅ Advanced seeding completed successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
