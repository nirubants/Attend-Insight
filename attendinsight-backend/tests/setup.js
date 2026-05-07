const { clearDatabase } = require('./utils');
const db = require('../db');

beforeAll(async () => {
  // Ensure DB is initialized
  await db.initDB();
});

afterAll(async () => {
  // Close pool to let process exit
  await db.pool.end();
});
