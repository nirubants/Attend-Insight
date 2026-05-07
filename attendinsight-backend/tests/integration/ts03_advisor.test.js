const request = require('supertest');
const { createApp } = require('../../server');
const { clearDatabase } = require('../utils');
const db = require('../../db');
const bcrypt = require('bcrypt');

let app;

describe('TS-03: Advisor – Early Intervention', () => {
  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const advisor = await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', ['Advisor', 'advisor@univ.edu', hashedPassword, 'advisor']);
    const student = await db.query('INSERT INTO users (name, email, password_hash, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id', ['John Doe', 'student@univ.edu', hashedPassword, 'student', 'Math']);
    const course = await db.query('INSERT INTO courses (code, name) VALUES ($1, $2) RETURNING id', ['CS101', 'Intro']);
    await db.query('INSERT INTO engagement_scores (student_id, course_id, attendance_rate, score, risk_level) VALUES ($1, $2, $3, $4, $5)', [student.rows[0].id, course.rows[0].id, 45, 30, 'High Risk']);

    this.testData = { advisorId: advisor.rows[0].id, studentId: student.rows[0].id, courseId: course.rows[0].id };
  });

  // TC-01: Advisor logs in → sees list of at-risk students with risk scores.
  test('TC-01: Advisor sees list of at-risk students', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'advisor@univ.edu', password: 'password123' });

    const res = await agent.get('/api/advisor/at-risk');
    expect(res.status).toBe(200);
    expect(res.body.students.length).toBeGreaterThan(0);
    expect(res.body.students[0].risk_level).toBe('High Risk');
  });

  // TC-03: Advisor logs intervention with notes → saved with timestamp, follow-up scheduled.
  test('TC-03: Advisor logs intervention with notes', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'advisor@univ.edu', password: 'password123' });

    const res = await agent.post('/api/interventions').send({
      studentId: this.testData.studentId,
      interventionType: 'Meeting',
      notes: 'Spoke with student about attendance.',
      followUpDate: '2026-06-01'
    });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/success/i);
  });

  // TC-04: Saving intervention with blank notes → Error: Notes Required.
  test('TC-04: Saving intervention with blank notes fails', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'advisor@univ.edu', password: 'password123' });

    const res = await agent.post('/api/interventions').send({
      studentId: this.testData.studentId,
      interventionType: 'Meeting',
      notes: '' // Blank notes
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/notes/i);
  });

  // TC-06: Advisor navigating to admin config URL → receives 403 or dashboard redirect.
  test('TC-06: Advisor cannot access admin dashboard data', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'advisor@univ.edu', password: 'password123' });

    const res = await agent.get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  // TC-02: Clicking a student opens their engagement trend graph and risk prediction.
  test('TC-02: Advisor view student profile trends', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'advisor@univ.edu', password: 'password123' });

    const res = await agent.get(`/api/advisor/student/${this.testData.studentId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('engagementTrend');
  });

  // TC-05: Engagement index value and trend are visible on the student profile.
  test('TC-05: Engagement index and trend visibility', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'advisor@univ.edu', password: 'password123' });

    const res = await agent.get(`/api/advisor/student/${this.testData.studentId}`);
    expect(res.status).toBe(200);
    expect(res.body.engagementIndex).toBeDefined();
  });
});
