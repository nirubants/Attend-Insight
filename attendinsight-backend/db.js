// db.js - Database setup using PostgreSQL (pg)
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper to run queries
const query = (text, params) => pool.query(text, params);

// Initialize schema
const initDB = async () => {
  try {
    // 1. Create Tables
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('faculty','advisor','admin','itadmin','student')),
        status TEXT NOT NULL DEFAULT 'Active',
        mfa_enabled INTEGER NOT NULL DEFAULT 0,
        department TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        faculty_id INTEGER,
        department TEXT,
        semester TEXT NOT NULL DEFAULT 'Fall 2026',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        course_id INTEGER NOT NULL,
        enrolled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, course_id),
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id SERIAL PRIMARY KEY,
        course_id INTEGER NOT NULL,
        faculty_id INTEGER NOT NULL,
        otp TEXT NOT NULL,
        qr_data TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMPTZ,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, student_id),
        FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS engagement_scores (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        course_id INTEGER NOT NULL,
        attendance_rate NUMERIC NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0,
        risk_level TEXT NOT NULL DEFAULT 'Low Risk' CHECK(risk_level IN ('Low Risk','Moderate Risk','High Risk')),
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, course_id),
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS interventions (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        advisor_id INTEGER NOT NULL,
        intervention_type TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','In Progress','Resolved','Closed')),
        follow_up_date DATE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        course_id INTEGER,
        alert_type TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'High' CHECK(severity IN ('High','Moderate','Low')),
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        id SERIAL PRIMARY KEY,
        role_id INTEGER NOT NULL,
        permission TEXT NOT NULL,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        UNIQUE(role_id, permission)
      );

      CREATE TABLE IF NOT EXISTS sync_logs (
        id SERIAL PRIMARY KEY,
        synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL,
        records_processed INTEGER NOT NULL,
        message TEXT,
        details JSONB
      );
    `);

    // 2. Default Roles & Settings
    await query("INSERT INTO settings (key, value) VALUES ('risk_threshold', '60') ON CONFLICT DO NOTHING");
    await query("INSERT INTO roles (name) VALUES ('faculty'), ('advisor'), ('admin'), ('itadmin'), ('student') ON CONFLICT DO NOTHING");

    // 3. Auto-seed Users
    const bcrypt = require('bcrypt');
    const hp = await bcrypt.hash('password123', 10);
    
    await query("INSERT INTO users (name, email, password_hash, role, department) VALUES ('Dr. Smith', 'faculty@univ.edu', $1, 'faculty', 'Computer Science') ON CONFLICT (email) DO NOTHING", [hp]);
    await query("INSERT INTO users (name, email, password_hash, role) VALUES ('Admin User', 'admin@univ.edu', $1, 'admin') ON CONFLICT (email) DO NOTHING", [hp]);
    await query("INSERT INTO users (name, email, password_hash, role) VALUES ('Advisor One', 'advisor@univ.edu', $1, 'advisor') ON CONFLICT (email) DO NOTHING", [hp]);
    await query("INSERT INTO users (name, email, password_hash, role) VALUES ('IT Admin', 'itadmin@univ.edu', $1, 'itadmin') ON CONFLICT (email) DO NOTHING", [hp]);
    await query("INSERT INTO users (name, email, password_hash, role, department) VALUES ('John Doe', 'student@univ.edu', $1, 'student', 'Computer Science') ON CONFLICT (email) DO NOTHING", [hp]);
    
    // Initial course and enrollment
    const facultyRes = await query("SELECT id FROM users WHERE email = 'faculty@univ.edu'");
    if (facultyRes.rowCount > 0) {
      await query("INSERT INTO courses (code, name, faculty_id, department) VALUES ('CS101', 'Intro to Computer Science', $1, 'Computer Science') ON CONFLICT (code) DO NOTHING", [facultyRes.rows[0].id]);
      const studentRes = await query("SELECT id FROM users WHERE email = 'student@univ.edu'");
      const courseRes = await query("SELECT id FROM courses WHERE code = 'CS101'");
      if (studentRes.rowCount > 0 && courseRes.rowCount > 0) {
        await query("INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [studentRes.rows[0].id, courseRes.rows[0].id]);
        await query("INSERT INTO engagement_scores (student_id, course_id, attendance_rate, score, risk_level) VALUES ($1, $2, 45, 30, 'High Risk') ON CONFLICT DO NOTHING", [studentRes.rows[0].id, courseRes.rows[0].id]);
      }
    }

    console.log('✅ PostgreSQL schema initialized.');
  } catch (err) {
    console.error('❌ Error initializing PostgreSQL schema:', err);
    throw err;
  }
};

module.exports = {
  pool,
  query,
  initDB,
};
