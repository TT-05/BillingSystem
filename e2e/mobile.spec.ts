import { test, expect } from '@playwright/test';
import { googleUser, createAndInvite, expense, report, respond } from './paymentHelpers';
test('mobile Google redirect, login persistence, payment controls, dialogs, and language switch', async ({
  page,
  browser,
}, testInfo) => {
  const suffix = Date.now();
  await googleUser(page, `mobile-owner-${suffix}@example.com`, 'Alice', true);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: testInfo.project.name.includes('webkit')
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
  });
  const debtor = await ctx.newPage();
  const email = `mobile-payer-${suffix}@example.com`;
  await googleUser(debtor, email, 'Bob', true);
  await createAndInvite(page, debtor, email);
  await expense(page, '60');
  await expect(page.getByTestId('receivables')).toContainText('$30.00');
  await expect(page.getByTestId('payables')).toContainText('$0.00');
  await debtor.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await report(debtor);
  await expect(debtor.locator('.payment-request[data-status=pending]')).toBeVisible();
  await page.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await respond(page, 'Confirm Receipt');
  await expect(debtor.getByRole('heading', { name: 'All square.' })).toBeVisible();
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '轻松结清往来。' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '一起把账记清楚。' })).toBeVisible();
  await expect(page.getByTestId('receivables')).toContainText('CA$0.00');
  await page.getByRole('button', { name: '添加支出', exact: true }).click();
  await page.getByLabel('描述', { exact: true }).fill('Mobile input');
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: '语言 / Language' })
    .selectOption('en');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Mobile input');
  await expect(page.getByLabel('Description', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  for (const screen of [page, debtor])
    expect(
      await screen.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  await page.screenshot({
    path: `/tmp/bills-two-party-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await ctx.close();
});

test('mobile email/password registration, sign-out, login and refresh remain usable', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('settle-language', 'en'));
  const email = `mobile-password-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Mobile Friend');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('MobilePassword123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sharing starts with a space.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('MobilePassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: /Mobile Friend/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Mobile Friend/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
