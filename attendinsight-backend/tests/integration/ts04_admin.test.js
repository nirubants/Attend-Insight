const request = require('supertest');
const { createApp } = require('../../server');
const { clearDatabase } = require('../utils');
const db = require('../../db');
const bcrypt = require('bcrypt');

let app;

describe('TS-04: Administrator – Policy Config & Alerts', () => {
  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    const hashedPassword = await bcrypt.hash('password123', 10);
    const admin = await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', ['Admin', 'admin@univ.edu', hashedPassword, 'admin']);
    this.testData = { adminId: admin.rows[0].id };
  });

  test('TC-02: Admin sets a valid risk threshold', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin@univ.edu', password: 'password123' });
    const res = await agent.put('/api/admin/settings/risk_threshold').send({ value: '75' });
    expect(res.status).toBe(200);
    const check = await db.query("SELECT value FROM settings WHERE key = 'risk_threshold'");
    expect(check.rows[0].value).toBe('75');
  });

  test('TC-03: Admin enters threshold > 100%', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin@univ.edu', password: 'password123' });
    const res = await agent.put('/api/admin/settings/risk_threshold').send({ value: '105' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Value Must Be Between 0–100');
  });

  test('TC-04: Admin enters a negative threshold', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin@univ.edu', password: 'password123' });
    const res = await agent.put('/api/admin/settings/risk_threshold').send({ value: '-10' });
    expect(res.status).toBe(400);
  });

  test('TC-05: System auto-generates alert on low attendance', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin@univ.edu', password: 'password123' });

    const faculty = await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ('F1', 'f1@u.edu', 'h', 'faculty') RETURNING id");
    const student = await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ('S1', 's1@u.edu', 'h', 'student') RETURNING id");
    const course = await db.query("INSERT INTO courses (code, name, faculty_id) VALUES ('C1', 'N1', $1) RETURNING id", [faculty.rows[0].id]);
    await db.query("INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)", [student.rows[0].id, course.rows[0].id]);

    // Create a closed session to ensure totalSessions > 0
    await db.query("INSERT INTO attendance_sessions (course_id, faculty_id, otp, status) VALUES ($1, $2, '123456', 'closed')", [course.rows[0].id, faculty.rows[0].id]);

    const { recalcEngagement } = require('../../utils/engagement');
    await recalcEngagement(student.rows[0].id, course.rows[0].id);

    const alerts = await db.query("SELECT * FROM alerts WHERE student_id = $1", [student.rows[0].id]);
    expect(alerts.rowCount).toBeGreaterThan(0);
  });

  test('TC-07: Admin dashboard trends loading', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin@univ.edu', password: 'password123' });
    const res = await agent.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('trendLabels');
  });

  test('TC-08: Admin generates report', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin@univ.edu', password: 'password123' });
    const res = await agent.get('/api/admin/reports/generate?startDate=2026-01-01&endDate=2026-01-31');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('downloadUrl');
  });
});
