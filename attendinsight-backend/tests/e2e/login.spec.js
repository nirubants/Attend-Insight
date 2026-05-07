const { test, expect } = require('@playwright/test');

test.describe('AttendInsight E2E Tests', () => {
  test('TC-01: Faculty logs in and sees dashboard', async ({ page }) => {
    await page.goto('http://localhost:3000/login.html');
    await page.fill('#email', 'faculty@univ.edu');
    await page.fill('#password', 'password123');
    await page.click('#loginBtn');

    await expect(page).toHaveURL(/faculty\.html/);
    await expect(page.locator('#facultyName')).toContainText('Dr. Smith');
  });

  test('TC-02: Dashboard displays assigned courses', async ({ page }) => {
    // We need to make sure the user is created in the DB before running this, 
    // or use a setup script for E2E.
    await page.goto('http://localhost:3000/login.html');
    await page.fill('#email', 'faculty@univ.edu');
    await page.fill('#password', 'password123');
    await page.click('#loginBtn');

    await expect(page.locator('.course-item')).toBeVisible();
  });
});
