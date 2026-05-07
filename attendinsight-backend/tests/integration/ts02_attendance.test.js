const request = require('supertest');
const { createApp } = require('../../server');
const { clearDatabase } = require('../utils');
const db = require('../../db');
const bcrypt = require('bcrypt');

let app;

describe('TS-02: Faculty – Attendance Session Generation', () => {
  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const faculty = await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', ['Faculty', 'faculty@univ.edu', hashedPassword, 'faculty']);
    const student = await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', ['John Doe', 'student@univ.edu', hashedPassword, 'student']);
    const course = await db.query('INSERT INTO courses (code, name, faculty_id) VALUES ($1, $2, $3) RETURNING id', ['CS101', 'Intro', faculty.rows[0].id]);
    await db.query('INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)', [student.rows[0].id, course.rows[0].id]);

    this.testData = { facultyId: faculty.rows[0].id, studentId: student.rows[0].id, courseId: course.rows[0].id };
  });

  test('TC-01: Faculty generates a QR code', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });
    const res = await agent.post('/api/sessions/create').send({ courseId: this.testData.courseId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('qrImage');
  });

  test('TC-02: Faculty generates a 6-digit OTP', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });
    const res = await agent.post('/api/sessions/create').send({ courseId: this.testData.courseId });
    expect(res.body.otp).toHaveLength(6);
  });

  test('TC-03: Student submits valid OTP', async () => {
    const facultyAgent = request.agent(app);
    await facultyAgent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });
    const sessionRes = await facultyAgent.post('/api/sessions/create').send({ courseId: this.testData.courseId });
    const otp = sessionRes.body.otp;
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: 'student@univ.edu', password: 'password123' });
    const res = await studentAgent.post('/api/sessions/submit').send({ otp, courseId: this.testData.courseId });
    expect(res.status).toBe(200);
  });

  test('TC-04: Student submits an expired OTP', async () => {
    const facultyAgent = request.agent(app);
    await facultyAgent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });
    const sessionRes = await facultyAgent.post('/api/sessions/create').send({ courseId: this.testData.courseId });
    const otp = sessionRes.body.otp;
    await db.query("UPDATE attendance_sessions SET created_at = NOW() - INTERVAL '5 minutes' WHERE id = $1", [sessionRes.body.sessionId]);
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: 'student@univ.edu', password: 'password123' });
    const res = await studentAgent.post('/api/sessions/submit').send({ otp, courseId: this.testData.courseId });
    expect(res.status).toBe(410);
  });

  test('TC-05: Student submits twice', async () => {
    const facultyAgent = request.agent(app);
    await facultyAgent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });
    const sessionRes = await facultyAgent.post('/api/sessions/create').send({ courseId: this.testData.courseId });
    const otp = sessionRes.body.otp;
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: 'student@univ.edu', password: 'password123' });
    await studentAgent.post('/api/sessions/submit').send({ otp, courseId: this.testData.courseId });
    const res = await studentAgent.post('/api/sessions/submit').send({ otp, courseId: this.testData.courseId });
    expect(res.status).toBe(409);
  });

  test('TC-06: Zero submissions marks students absent', async () => {
    const facultyAgent = request.agent(app);
    await facultyAgent.post('/api/auth/login').send({ email: 'faculty@univ.edu', password: 'password123' });
    const sessionRes = await facultyAgent.post('/api/sessions/create').send({ courseId: this.testData.courseId });
    await facultyAgent.post(`/api/sessions/${sessionRes.body.sessionId}/close`).send({});
    const res = await facultyAgent.get(`/api/faculty/students?courseId=${this.testData.courseId}`);
    const student = res.body.students.find(s => s.id === this.testData.studentId);
    expect(Number(student.attendance_rate)).toBe(0);
  });
});
