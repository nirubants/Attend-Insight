const db = require('../db');

async function clearDatabase() {
  const tables = [
    'alerts',
    'interventions',
    'engagement_scores',
    'attendance_records',
    'attendance_sessions',
    'enrollments',
    'courses',
    'users',
    'sync_logs',
    'settings',
    'role_permissions',
    'roles'
  ];
  for (const table of tables) {
    await db.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
  }
}

module.exports = { clearDatabase };
