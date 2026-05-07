const request = require('supertest');
const { createApp } = require('../../server');
const { clearDatabase } = require('../utils');
const db = require('../../db');
const bcrypt = require('bcrypt');

let app;

describe('TS-05: IT Admin – User Role Management', () => {
  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    const hashedPassword = await bcrypt.hash('password123', 10);
    const itadmin = await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', ['IT Admin', 'itadmin@univ.edu', hashedPassword, 'itadmin']);
    
    // Seed default roles
    await db.query("INSERT INTO roles (name) VALUES ('faculty'), ('advisor'), ('admin'), ('itadmin'), ('student') ON CONFLICT DO NOTHING");
    
    this.testData = { itadminId: itadmin.rows[0].id };
  });

  // TC-02: Create role with valid name and permissions → saved, enforced system-wide.
  test('TC-02: Create role with valid name and permissions', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    const res = await agent.post('/api/itadmin/roles').send({
      name: 'Registrar',
      permissions: ['view_students', 'edit_grades']
    });
    expect(res.status).toBe(201);
    expect(res.body.roleId).toBeDefined();

    const role = await db.query('SELECT * FROM roles WHERE name = $1', ['Registrar']);
    expect(role.rowCount).toBe(1);
  });

  // TC-03: Create role with a duplicate name → Error: Role Name Already Exists.
  test('TC-03: Create role with a duplicate name', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    await agent.post('/api/itadmin/roles').send({ name: 'Manager' });
    const res = await agent.post('/api/itadmin/roles').send({ name: 'Manager' });
    
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Role Name Already Exists');
  });

  // TC-06: Deactivate role that still has active users → warning or block shown.
  test('TC-06: Deactivate role with active users fails', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    // Faculty role has an IT Admin user? No, let's create a faculty user.
    await db.query("INSERT INTO users (name, email, password_hash, role, status) VALUES ('F1', 'f1@u.edu', 'h', 'faculty', 'Active')");
    
    const roleRes = await db.query("SELECT id FROM roles WHERE name = 'faculty'");
    const roleId = roleRes.rows[0].id;

    const res = await agent.put(`/api/itadmin/roles/${roleId}`).send({ status: 'Inactive' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/active users/i);
  });

  // TC-04: Update permissions on existing role → changes applied immediately.
  test('TC-04: Update permissions on existing role', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    const roleRes = await db.query("SELECT id FROM roles WHERE name = 'advisor'");
    const roleId = roleRes.rows[0].id;

    const res = await agent.put(`/api/itadmin/roles/${roleId}`).send({
      permissions: ['read_only', 'view_reports']
    });
    expect(res.status).toBe(200);

    const perms = await db.query("SELECT * FROM role_permissions WHERE role_id = $1", [roleId]);
    expect(perms.rowCount).toBe(2);
  });

  // TC-05: Deactivate role with no active users → role marked inactive.
  test('TC-05: Deactivate role with no users', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'itadmin@univ.edu', password: 'password123' });

    const roleRes = await agent.post('/api/itadmin/roles').send({ name: 'EmptyRole' });
    const roleId = roleRes.body.roleId;

    const res = await agent.put(`/api/itadmin/roles/${roleId}`).send({ status: 'Inactive' });
    expect(res.status).toBe(200);

    const role = await db.query("SELECT status FROM roles WHERE id = $1", [roleId]);
    expect(role.rows[0].status).toBe('Inactive');
  });
});
