const request = require('supertest');
const { createApp } = require('../../server');
const { clearDatabase } = require('../utils');
const db = require('../../db');
const bcrypt = require('bcrypt');

let app;

describe('TS-06: IT Admin – Data Synchronisation', () => {
  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    const hashedPassword = await bcrypt.hash('password123', 10);
    await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)', ['IT Admin', 'itadmin@univ.edu', hashedPassword, 'itadmin']);
  });

  // TC-02: Sync completes with valid LMS data → success message; log entry created.
  test('TC-02: Sync completes and creates log entry', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    const res = await agent.post('/api/itadmin/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const logs = await db.query('SELECT * FROM sync_logs');
    expect(logs.rowCount).toBe(1);
    expect(logs.rows[0].status).toBe('success');
  });

  // TC-03: Sync attempted with LMS offline → Error: Connection Failed; failure logged.
  test('TC-03: Sync attempted with LMS offline', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    const res = await agent.post('/api/itadmin/sync').send({ simulateOffline: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Connection Failed/i);

    const logs = await db.query("SELECT * FROM sync_logs WHERE status = 'error'");
    expect(logs.rowCount).toBe(1);
  });

  // TC-05: View sync history → log shows timestamp, status, and record count per sync.
  test('TC-05: View sync history', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    await agent.post('/api/itadmin/sync').send({});
    
    const res = await agent.get('/api/itadmin/sync/history');
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThan(0);
    expect(res.body.history[0]).toHaveProperty('synced_at');
    expect(res.body.history[0]).toHaveProperty('records_processed');
  });

  // TC-01: Initiate sync from LMS → progress indicator shown.
  test('TC-01: Initiate sync', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    const res = await agent.post('/api/itadmin/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/triggered|completed/i);
  });

  // TC-04: LMS returns malformed records → valid records imported; errors logged.
  test('TC-04: Sync handles malformed records simulation', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    // We can simulate this by passing a flag to our scaffolded sync endpoint
    const res = await agent.post('/api/itadmin/sync').send({ simulateMalformed: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success'); // Partial success is still 200
  });
});
