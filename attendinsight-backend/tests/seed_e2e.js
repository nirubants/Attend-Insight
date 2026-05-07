const db = require('../db');
const bcrypt = require('bcrypt');

async function seed() {
  await db.initDB();
  
  // Clear all
  const tables = ['alerts', 'interventions', 'engagement_scores', 'attendance_records', 'attendance_sessions', 'enrollments', 'courses', 'users', 'sync_logs', 'settings'];
  for (const table of tables) {
    await db.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
  }

  const hp = await bcrypt.hash('password123', 10);
  
  // IT Admin
  await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ('IT Admin', 'itadmin@univ.edu', $1, 'itadmin')", [hp]);
  
  // Admin
  await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Admin User', 'admin@univ.edu', $1, 'admin')", [hp]);
  
  // Faculty
  const faculty = await db.query("INSERT INTO users (name, email, password_hash, role, department) VALUES ('Dr. Smith', 'faculty@univ.edu', $1, 'faculty', 'Computer Science') RETURNING id", [hp]);
  
  // Advisor
  await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Advisor One', 'advisor@univ.edu', $1, 'advisor')", [hp]);
  
  // Student
  const student = await db.query("INSERT INTO users (name, email, password_hash, role, department) VALUES ('John Doe', 'student@univ.edu', $1, 'student', 'Computer Science') RETURNING id", [hp]);
  
  // Course
  const course = await db.query("INSERT INTO courses (code, name, faculty_id, department) VALUES ('CS101', 'Intro to CS', $1, 'Computer Science') RETURNING id", [faculty.rows[0].id]);
  
  // Enrollment
  await db.query("INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)", [student.rows[0].id, course.rows[0].id]);
  
  // Engagement
  await db.query("INSERT INTO engagement_scores (student_id, course_id, attendance_rate, score, risk_level) VALUES ($1, $2, 45, 30, 'High Risk')", [student.rows[0].id, course.rows[0].id]);

  console.log("✅ E2E Seed completed.");
  process.exit(0);
}

seed();
