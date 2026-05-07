const request = require('supertest');
const { createApp } = require('../../server');
const { clearDatabase } = require('../utils');
const db = require('../../db');
const bcrypt = require('bcrypt');

let app;

describe('TS-01: Faculty – Course Engagement', () => {
  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    
    // Setup test data
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    // Create Faculty
    const facultyResult = await db.query(
      'INSERT INTO users (name, email, password_hash, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['Dr. Smith', 'faculty@univ.edu', hashedPassword, 'faculty', 'Computer Science']
    );
    const facultyId = facultyResult.rows[0].id;

    // Create Student
    const studentResult = await db.query(
      'INSERT INTO users (name, email, password_hash, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['John Doe', 'student@univ.edu', hashedPassword, 'student', 'Computer Science']
    );
    const studentId = studentResult.rows[0].id;

    // Create Course
    const courseResult = await db.query(
      'INSERT INTO courses (code, name, faculty_id, department) VALUES ($1, $2, $3, $4) RETURNING id',
      ['CS101', 'Intro to CS', facultyId, 'Computer Science']
    );
    const courseId = courseResult.rows[0].id;

    // Enroll Student
    await db.query(
      'INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)',
      [studentId, courseId]
    );

    // Create Engagement Score (At-risk)
    await db.query(
      'INSERT INTO engagement_scores (student_id, course_id, attendance_rate, score, risk_level) VALUES ($1, $2, $3, $4, $5)',
      [studentId, courseId, 45, 30, 'High Risk']
    );

    this.testData = { facultyId, studentId, courseId };
  });

  // TC-01: Faculty logs in with valid credentials → redirected to Faculty Dashboard.
  test('TC-01: Faculty logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'faculty@univ.edu', password: 'password123' });
    
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('faculty');
  });

  // TC-03: Clicking a course loads engagement metrics and attendance trends.
  test('TC-03: Loading engagement metrics for faculty dashboard', async () => {
    // Need to login first to get session
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });

    const res = await agent.get('/api/faculty/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('avgAttendance');
    expect(res.body).toHaveProperty('engagementIndex');
  });

  // TC-04: Students below the risk threshold are flagged in the at-risk section.
  test('TC-04: Students below threshold are flagged', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });

    const res = await agent.get(`/api/faculty/students?courseId=${this.testData.courseId}`);
    expect(res.status).toBe(200);
    const atRisk = res.body.students.filter(s => s.risk_level === 'High Risk');
    expect(atRisk.length).toBeGreaterThan(0);
    expect(atRisk[0].name).toBe('John Doe');
  });

  // TC-05: Clicking an at-risk student opens their session-level attendance history.
  test('TC-05: Fetching student attendance history', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });

    const res = await agent.get(`/api/faculty/student/${this.testData.studentId}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('history');
  });

  // TC-06: A course where all students are above threshold shows no at-risk entries.
  test('TC-06: Course with no at-risk students', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });

    // Update student to be low risk
    await db.query('UPDATE engagement_scores SET risk_level = \'Low Risk\', attendance_rate = 95 WHERE student_id = $1', [this.testData.studentId]);

    const res = await agent.get(`/api/faculty/students?courseId=${this.testData.courseId}`);
    const atRisk = res.body.students.filter(s => s.risk_level === 'High Risk');
    expect(atRisk.length).toBe(0);
  });
});
